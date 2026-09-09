/*
 * Every answer the kinship engine gives about one family, written down.
 *
 * This is not a test of what the answers *should* be. It is a record of what they *are*, taken
 * from `main` before anything was changed, so that a change to `relate` has to show its work: the
 * diff on `kinship-golden.txt` is the list of families whose answer moved, and a PR that moves one
 * without meaning to is visible at a glance instead of being discovered by somebody's grandmother.
 *
 * There is a change coming that will move it -- the graph walk enqueues marriage steps before blood
 * ones, where the Kotlin does the opposite (#119) -- and the whole point of writing this first is
 * that the reordering arrives as a diff somebody can read.
 *
 * Two tables:
 *
 *   the family    every ordered pair of `sample-family.ftree`: 23 people, 506 pairs, each with its
 *                 term, `marriedTo`, `ofSpouse`, the shared ancestor it went through, and the chain
 *                 of labels. Real shapes -- half-siblings, a second marriage, people connected to
 *                 nobody -- rather than shapes invented to be tested.
 *
 *   the lattice   `kinshipTerm` over u 0..6 x d 0..6 x three genders: 147 cases. The family cannot
 *                 reach a third cousin twice removed, and the arithmetic that names one is exactly
 *                 the arithmetic that is about to be refactored.
 *
 *   the shapes    small families the sample family does not contain. One of them is a *tie*: two
 *                 routes of the same length reach the same person, one through blood and one
 *                 through marriage. That table exists because the first draft of this golden did
 *                 not have it -- the #119 reorder was applied experimentally and moved **not one
 *                 line**, because `sample-family.ftree` has no ties in it at all. A golden that
 *                 cannot see the change it exists to police is decoration.
 *
 * Regenerate deliberately, never casually: `UPDATE_GOLDEN=1 node --test site/playground/relate-golden.test.mjs`
 * The regenerated file is the deliverable of the PR that moves it, and it should be read.
 */

import test from 'node:test';
import assert from 'node:assert';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openArchive, parseDocument } from './archive.js';
import { buildGraph, relate, kinshipTerm, displayName } from './model.js';

/** `openArchive` wants an ArrayBuffer; `readFile` gives a Buffer over a shared one. */
async function familyGraph() {
  const buffer = await readFile(FAMILY);
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const archive = await openArchive(bytes);
  return buildGraph(parseDocument(await archive.readText('tree.json')));
}

const here = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = path.join(here, 'kinship-golden.txt');
const FAMILY = path.join(here, 'sample-family.ftree');

/** Sorts a person's id to a stable name for the file, so the diff is about answers, not order. */
const label = (graph, id) => {
  const person = graph.people.get(id);
  return `${displayName(person)} [${id}]`;
};

/**
 * One line per ordered pair.
 *
 * Ordered, not unordered: "how is A related to B" and "how is B related to A" are different
 * questions with different answers -- one is an uncle and the other a nephew -- and a golden that
 * folded them together would hide exactly the half of the change worth seeing.
 */
function familyTable(graph) {
  const ids = [...graph.people.keys()].sort();
  const lines = [];
  for (const from of ids) {
    for (const to of ids) {
      if (from === to) continue;
      const answer = relate(graph, from, to);
      lines.push([
        `${label(graph, from)} -> ${label(graph, to)}`,
        `kind=${answer.kind}`,
        `term=${answer.term ?? '-'}`,
        `marriedTo=${answer.marriedTo ? `${answer.marriedTo.term}:${answer.marriedTo.person.id}` : '-'}`,
        `ofSpouse=${answer.ofSpouse ? `${answer.ofSpouse.term}:${answer.ofSpouse.spouse.id}` : '-'}`,
        `via=${answer.via ?? '-'}`,
        `chain=${(answer.path ?? []).map((s) => `${s.via}/${s.label}/${s.id}`).join(' > ') || '-'}`,
      ].join('  '));
    }
  }
  return lines;
}

/*
 * Shapes the sample family does not contain, and one of them is the whole point.
 *
 * **The tie.** Two brothers marry two sisters. My wife's sister is also my brother's wife, and she
 * is two steps away either way -- spouse-then-sibling, or sibling-then-spouse. Whichever of my wife
 * and my brother is enqueued first is the one who names her, which is exactly what the neighbour
 * order decides. The Kotlin walks blood before marriage so that where two routes tie, the answer
 * comes through the family: reaching somebody through their spouse is a true answer and a useless
 * one. The order can only matter here -- both searches are breadth-first, so a shorter route wins
 * regardless.
 *
 * **A marriage at the far end**, where English has no single word: my first cousin's husband. This
 * one does not tie; it is here because it is the third sentence shape (`marriedTo`), the case where
 * the engine deliberately declines to invent a word and says who somebody married instead, and the
 * sample family exercises it only glancingly.
 */
const SHAPES = {
  'two brothers married two sisters — a tie': {
    people: [
      { id: 'me', name: 'Me', gender: 'MALE', birthDate: '1980' },
      { id: 'brother', name: 'My Brother', gender: 'MALE', birthDate: '1978' },
      { id: 'wife', name: 'My Wife', gender: 'FEMALE', birthDate: '1982' },
      { id: 'her-sister', name: 'Her Sister', gender: 'FEMALE', birthDate: '1984' },
      { id: 'our-father', name: 'Our Father', gender: 'MALE', birthDate: '1950' },
      { id: 'their-father', name: 'Their Father', gender: 'MALE', birthDate: '1952' },
    ],
    relationships: [
      { from: 'our-father', to: 'me', type: 'PARENT' },
      { from: 'our-father', to: 'brother', type: 'PARENT' },
      { from: 'their-father', to: 'wife', type: 'PARENT' },
      { from: 'their-father', to: 'her-sister', type: 'PARENT' },
      { from: 'me', to: 'wife', type: 'SPOUSE' },
      { from: 'brother', to: 'her-sister', type: 'SPOUSE' },
    ],
  },
  'a first cousin’s husband — a marriage at the far end, with no English word for it': {
    people: [
      { id: 'me', name: 'Me', gender: 'MALE', birthDate: '1980' },
      { id: 'cousin', name: 'My Cousin', gender: 'FEMALE', birthDate: '1981' },
      { id: 'her-husband', name: 'Her Husband', gender: 'MALE', birthDate: '1979' },
      { id: 'my-father', name: 'My Father', gender: 'MALE', birthDate: '1950' },
      { id: 'my-uncle', name: 'My Uncle', gender: 'MALE', birthDate: '1948' },
      { id: 'grandfather', name: 'Grandfather', gender: 'MALE', birthDate: '1920' },
      { id: 'my-sister', name: 'My Sister', gender: 'FEMALE', birthDate: '1983' },
      { id: 'his-brother', name: 'His Brother', gender: 'MALE', birthDate: '1977' },
    ],
    relationships: [
      { from: 'grandfather', to: 'my-father', type: 'PARENT' },
      { from: 'grandfather', to: 'my-uncle', type: 'PARENT' },
      { from: 'my-father', to: 'me', type: 'PARENT' },
      { from: 'my-father', to: 'my-sister', type: 'PARENT' },
      { from: 'my-uncle', to: 'cousin', type: 'PARENT' },
      { from: 'cousin', to: 'her-husband', type: 'SPOUSE' },
      { from: 'my-sister', to: 'his-brother', type: 'SPOUSE' },
    ],
  },
};

function shapeTable() {
  const lines = [];
  for (const [name, doc] of Object.entries(SHAPES)) {
    lines.push(`### ${name}`);
    const graph = buildGraph(doc);
    lines.push(...familyTable(graph));
    lines.push('');
  }
  return lines;
}

/**
 * `kinshipTerm` over the whole lattice it is defined on.
 *
 * `u` is steps up to the shared ancestor and `d` steps down from it, so (1,1) is a sibling, (2,1)
 * an uncle, (2,2) a first cousin. Six of each is past anything a real file reaches and well past
 * where the greats start piling up, which is where an off-by-one would live.
 */
function latticeTable() {
  const lines = [];
  for (let u = 0; u <= 6; u++) {
    for (let d = 0; d <= 6; d++) {
      for (const gender of ['MALE', 'FEMALE', 'UNSPECIFIED']) {
        lines.push(`u=${u} d=${d} ${gender.padEnd(11)} ${kinshipTerm(u, d, { gender })}`);
      }
    }
  }
  return lines;
}

async function render() {
  const graph = await familyGraph();
  const family = familyTable(graph);
  const lattice = latticeTable();
  const shapes = shapeTable();

  return [
    '# Every answer the kinship engine gives, written down.',
    '# Generated by relate-golden.test.mjs. Regenerate with UPDATE_GOLDEN=1, and read the diff.',
    '',
    `## the family — sample-family.ftree, ${graph.people.size} people, ${family.length} ordered pairs`,
    '',
    ...family,
    '',
    '## the shapes — families the sample family does not contain, including one that ties',
    '',
    ...shapes,
    `## the lattice — kinshipTerm over u 0..6 x d 0..6 x three genders, ${lattice.length} cases`,
    '',
    ...lattice,
    '',
  ].join('\n');
}

test('the kinship engine says what it has always said', async () => {
  const current = await render();

  if (process.env.UPDATE_GOLDEN) {
    await writeFile(GOLDEN, current);
    return;
  }

  let expected;
  try {
    expected = await readFile(GOLDEN, 'utf8');
  } catch {
    assert.fail(`${GOLDEN} is missing. Generate it with UPDATE_GOLDEN=1 and commit it.`);
  }

  if (expected === current) return;

  // A whole-file diff is unreadable at 653 lines, so say which lines moved and show the first few.
  const was = expected.split('\n');
  const now = current.split('\n');
  const moved = [];
  for (let i = 0; i < Math.max(was.length, now.length); i++) {
    if (was[i] !== now[i]) moved.push(`  line ${i + 1}\n    was: ${was[i] ?? '(nothing)'}\n    now: ${now[i] ?? '(nothing)'}`);
  }
  assert.fail(
    `${moved.length} line(s) of the kinship golden moved.\n\n${moved.slice(0, 12).join('\n')}\n\n`
    + (moved.length > 12 ? `  ...and ${moved.length - 12} more.\n\n` : '')
    + 'If the change is intended, regenerate with UPDATE_GOLDEN=1 and make the diff the PR.',
  );
});

test('the golden covers every ordered pair and the whole lattice', async () => {
  // A golden that silently stopped covering something would keep passing forever.
  const graph = await familyGraph();
  const n = graph.people.size;

  assert.strictEqual(familyTable(graph).length, n * (n - 1), 'every ordered pair');
  assert.strictEqual(latticeTable().length, 7 * 7 * 3, '147 lattice cases');
  assert.ok(n >= 20, `the sample family should be a real family, got ${n}`);
  assert.ok(Object.keys(SHAPES).length >= 2, 'the extra shapes are still here');
});

/**
 * The tie family really does tie.
 *
 * Stated exactly rather than as "contains a marriage step somewhere", because a vague version of
 * this check would keep passing after an edit that removed the ambiguity, and the golden would then
 * be blind again in precisely the way that made this table necessary.
 *
 * The claim: `her-sister` is two steps from `me`, and *both* of the people one step from `me` --
 * the wife, reached by marriage, and the brother, reached by blood -- are adjacent to her. That is
 * a tie, and it is the only situation in which the neighbour order can change an answer.
 */
test('the tie family really does tie', () => {
  const graph = buildGraph(SHAPES['two brothers married two sisters — a tie']);
  const neighbours = (id) => new Set([
    ...graph.parents(id).map((p) => p.id),
    ...graph.children(id).map((c) => c.id),
    ...graph.siblings(id).map((s) => s.id),
    ...graph.spouses(id).map((s) => s.id),
  ]);

  const oneStep = neighbours('me');
  assert.ok(oneStep.has('wife'), 'the wife is one step away, through marriage');
  assert.ok(oneStep.has('brother'), 'the brother is one step away, through blood');
  assert.ok(!oneStep.has('her-sister'), 'and she is not one step away by either');

  assert.ok(neighbours('wife').has('her-sister'), 'reachable in two: spouse then sibling');
  assert.ok(neighbours('brother').has('her-sister'), 'reachable in two: sibling then spouse');

  assert.strictEqual(relate(graph, 'me', 'her-sister').path.length, 2);
});
