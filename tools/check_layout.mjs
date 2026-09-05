/*
 * Exercises the playground's parsing and layout outside a browser.
 *
 * The layout is the part most likely to be quietly wrong - a chart that renders is not the same as
 * a chart that is correct - so the invariants worth holding are asserted here rather than eyeballed
 * in a screenshot: everybody is placed exactly once, nobody overlaps anybody on their own row, and
 * every connector lands on a node that exists.
 */

import { readFile } from 'node:fs/promises';
import { openArchive, parseDocument } from '../site/playground/archive.js';
import { buildGraph, relate, kinshipTerm } from '../site/playground/model.js';
import { layoutArchive, METRICS } from '../site/playground/layout.js';

// Defaults to the directory tools/make_sample_tree.py writes to; CI points it somewhere else.
const FIXTURES = process.argv[2] ?? '/tmp/ftree-fixtures';

let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${detail ? `  ${detail}` : ''}`);
};

async function load(path) {
  const buffer = await readFile(path);
  const array = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const archive = await openArchive(array);
  const doc = parseDocument(await archive.readText('tree.json'));
  return { archive, doc };
}

async function run(name, { expectPhotos = false } = {}) {
  const path = `${FIXTURES}/${name}`;
  console.log(`\n=== ${path}`);
  const started = Date.now();
  const { archive, doc } = await load(path);
  const graph = buildGraph(doc);
  const parsed = Date.now();
  const layout = layoutArchive(graph);
  const done = Date.now();

  console.log(`     ${doc.people.length} people, ${doc.relationships.length} relationships, ` +
    `${graph.components.length} components, ${graph.isolated.length} isolated`);
  console.log(`     parse ${parsed - started}ms, layout ${done - parsed}ms, ` +
    `canvas ${Math.round(layout.width)}x${Math.round(layout.height)}`);

  check('every person is placed exactly once',
    layout.nodes.length === graph.people.size && layout.byId.size === graph.people.size,
    `${layout.nodes.length} nodes for ${graph.people.size} people`);

  // Nobody may overlap anybody sharing their row.
  const rows = new Map();
  for (const n of layout.nodes) {
    const key = Math.round(n.y);
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(n);
  }
  let overlaps = 0;
  let tightest = Infinity;
  for (const row of rows.values()) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) {
      const gap = row[i].x - (row[i - 1].x + METRICS.NODE_W);
      if (gap < -0.5) overlaps++;
      tightest = Math.min(tightest, gap);
    }
  }
  check('no two people overlap on a row', overlaps === 0,
    `${overlaps} overlaps, tightest gap ${tightest === Infinity ? 'n/a' : tightest.toFixed(1)}`);

  // Couples must be closer than strangers, or the notation says nothing.
  let coupleGapsOk = true;
  for (const link of layout.couples) {
    if (link.x2 - link.x1 > METRICS.SIBLING_GAP) coupleGapsOk = false;
  }
  check('partners sit closer than neighbours', coupleGapsOk, `${layout.couples.length} couple links`);

  // Every connector must land on a node that exists.
  const ids = new Set(layout.nodes.map((n) => n.id));
  const danglingDescents = layout.descents.filter(
    (d) => d.parents.some((p) => !ids.has(p)) || d.children.some((c) => !ids.has(c))
  ).length;
  check('every descent connector lands on placed people', danglingDescents === 0);

  // A child must be drawn below its parents, or the chart is lying about direction.
  let inverted = 0;
  for (const id of graph.order) {
    const child = layout.byId.get(id);
    for (const p of graph.parents(id)) {
      const parent = layout.byId.get(p.id);
      if (parent && child && parent.y >= child.y) inverted++;
    }
  }
  check('children are drawn below their parents', inverted === 0, `${inverted} inverted`);

  /*
   * Stronger than "below": a child belongs exactly one row below each parent, and siblings belong
   * on one row as each other. Ranking people by how far back their ancestry happens to be recorded
   * satisfies the weaker check and still draws a wrong chart - a grandfather whose own parents are
   * unknown lands on the top row beside a great-great-grandfather, and his children scatter across
   * rows according to whom each of them married.
   */
  let notOneApart = 0;
  for (const id of graph.order) {
    const child = layout.byId.get(id);
    for (const p of graph.parents(id)) {
      const parent = layout.byId.get(p.id);
      if (parent && child && child.level - parent.level !== 1) notOneApart++;
    }
  }
  check('every parent is exactly one row above every child', notOneApart === 0,
    `${notOneApart} edges spanning the wrong number of rows`);

  let splitSiblings = 0;
  for (const [parent, kids] of graph.childrenOf) {
    const rows = new Set();
    for (const c of kids.values()) {
      const node = layout.byId.get(c.id);
      if (node) rows.add(node.level);
    }
    if (rows.size > 1) splitSiblings++;
  }
  check('siblings share a row whoever each of them married', splitSiblings === 0,
    `${splitSiblings} sets of siblings spread over more than one row`);

  let splitCouples = 0;
  for (const [a, set] of graph.spousesOf) {
    for (const s of set.values()) {
      const left = layout.byId.get(a);
      const right = layout.byId.get(s.id);
      if (a < s.id && left && right && left.level !== right.level) splitCouples++;
    }
  }
  check('partners share a row', splitCouples === 0, `${splitCouples} couples split`);

  // Isolated people are the reason this page exists; they must be on the canvas.
  const isolatedPlaced = graph.isolated.every((id) => layout.byId.has(id));
  check('unconnected people are on the canvas', isolatedPlaced,
    `${graph.isolated.length} of them`);

  // Photos need Pillow to generate, which CI may not have; the fixture is still valid without
  // them, so this asserts only when there are photos to assert about.
  const withPhotos = doc.people.filter((p) => p.photo);
  if (expectPhotos && withPhotos.length) {
    const present = withPhotos.filter((p) => archive.has(p.photo));
    check('photos referenced by the json are in the archive',
      present.length === withPhotos.length, `${present.length}/${withPhotos.length}`);
    const bytes = await archive.read(withPhotos[0].photo);
    check('a photo inflates to a JPEG', bytes[0] === 0xff && bytes[1] === 0xd8,
      `${bytes.length} bytes`);
  } else if (expectPhotos) {
    console.log('  skip  no photos in this fixture (Pillow absent when it was built)');
  }

  return { graph, layout };
}

/* Kinship naming is pure arithmetic on two distances, so it is worth pinning exactly. */
function checkKinship() {
  console.log('\n=== kinship terms');
  const male = { gender: 'MALE' };
  const female = { gender: 'FEMALE' };
  const cases = [
    [1, 0, male, 'father'],
    [2, 0, female, 'grandmother'],
    [3, 0, male, 'great-grandfather'],
    [4, 0, male, 'great-great-grandfather'],
    [0, 1, female, 'daughter'],
    [0, 3, male, 'great-grandson'],
    [1, 1, male, 'brother'],
    [2, 1, female, 'aunt'],
    [3, 1, male, 'great-uncle'],
    [1, 2, male, 'nephew'],
    [2, 2, male, 'first cousin'],
    [2, 3, male, 'first cousin once removed'],
    [3, 3, female, 'second cousin'],
    [4, 2, male, 'first cousin twice removed'],
  ];
  for (const [u, d, person, expected] of cases) {
    const actual = kinshipTerm(u, d, person);
    check(`up ${u} down ${d} -> ${expected}`, actual === expected, actual === expected ? '' : `got "${actual}"`);
  }
}

const { graph } = await run('sample-family.ftree', { expectPhotos: true });
// The same tree written through an unseekable stream, which zeroes the local file headers exactly
// as java.util.zip.ZipOutputStream does. A reader that trusts those headers passes the first and
// fails this one.
await run('sample-streamed.ftree', { expectPhotos: true });
await run('large-tree.ftree');
checkKinship();

console.log('\n=== relating two people');
const find = (name) => [...graph.people.values()].find((p) => p.name === name)?.id;
for (const [a, b] of [['Aarav Kumar', 'Shyam Lal'], ['Ankit Kumar', 'Meena Kumari'],
  ['Ankit Kumar', 'Lata Sharma'], ['Neha Kumar', 'Arun Prasad']]) {
  const result = relate(graph, find(a), find(b));
  const chain = result.path?.map((s) => s.label).join(' -> ') ?? 'no path';
  console.log(`  ${a} -> ${b}: ${result.term ?? 'no blood term'}   [${chain}]`);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} CHECKS FAILED.`);
process.exit(failures === 0 ? 0 : 1);
