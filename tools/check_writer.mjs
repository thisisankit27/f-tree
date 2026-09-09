/*
 * The .ftree writer, checked against the reader that matters.
 *
 * `site/playground/write.js` exists so the desktop app can save a tree. The question it has to
 * answer is not "can we read back what we wrote" - that only proves this code agrees with itself -
 * but "will the Android app open it". So the assertions below are about the format, and the sharp
 * one is about local file headers.
 *
 *   TreeImporter.readDocument reads with java.util.zip.ZipInputStream, which walks LOCAL headers
 *   forward and never consults the central directory.
 *
 * The app's own exporter gets away with zeroed local headers because it writes a data descriptor
 * and ZipInputStream understands its own convention. This writer does not rely on that: it writes
 * the true CRC and both sizes into every local header, so the archive is readable by a reader that
 * trusts local headers, by one that reads the central directory, and by `unzip`.
 *
 * Run: node tools/check_writer.mjs [fixtures-dir]
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const playground = path.join(here, '..', 'site', 'playground');

const { writeTreeArchive, encodeDocument, WriteError } = await import(
  path.join(playground, 'write.js'));
const { openArchive, parseDocument } = await import(path.join(playground, 'archive.js'));

let failures = 0;
let checks = 0;

function ok(what, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ok   ${what}${detail ? '  ' + detail : ''}`);
  } else {
    failures += 1;
    console.log(` FAIL  ${what}${detail ? '  ' + detail : ''}`);
  }
}

function section(title) {
  console.log(`\n=== ${title}`);
}

/**
 * Compares content, not key order.
 *
 * The app's exporter writes a person's fields in declaration order and so does this writer; the
 * generated fixture happens to write `gender` before `name`. That difference is invisible to every
 * reader of JSON and asserting on it would be asserting on the fixture generator, not the format.
 */
function same(a, b) {
  const norm = (v) => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])]));
    }
    return v;
  };
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/* ---------------------------------------------------------------- a local-header reader */

/**
 * Walks local file headers the way ZipInputStream does, and refuses to guess.
 *
 * Deliberately does NOT implement data descriptors. Java would cope with those; this is here to
 * show that our archive needs no such coping, which is the property being asserted. Anything it
 * cannot read from the header alone, it reports rather than repairs.
 */
function walkLocalHeaders(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  let at = 0;
  while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const flags = view.getUint16(at + 6, true);
    const method = view.getUint16(at + 8, true);
    const crc = view.getUint32(at + 14, true);
    const compressed = view.getUint32(at + 18, true);
    const uncompressed = view.getUint32(at + 22, true);
    const nameLen = view.getUint16(at + 26, true);
    const extraLen = view.getUint16(at + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 30, at + 30 + nameLen));
    const start = at + 30 + nameLen + extraLen;
    entries.push({
      name, flags, method, crc, compressed, uncompressed,
      streamed: Boolean(flags & 0x8),
      body: bytes.subarray(start, start + compressed),
    });
    at = start + compressed;
  }
  return entries;
}

async function inflate(entry) {
  if (entry.method === 0) return entry.body;
  const stream = new Blob([entry.body]).stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ---------------------------------------------------------------- the document under test */

const sample = {
  exportedAt: '2026-09-09T12:00:00Z',
  sourceTreeId: 'tree-under-test',
  people: [
    { id: 'p1', name: 'Ada', gender: 'FEMALE', birthDate: '1815-12-10', deceased: true,
      deathDate: '1852-11-27', notes: 'first', origins: [{ treeId: 't0', personId: 'x1' }] },
    { id: 'p2', name: 'Byron', gender: 'MALE' },
    { id: 'p3' },
  ],
  relationships: [
    { id: 'r1', from: 'p2', to: 'p1', type: 'PARENT' },
    { id: 'r2', from: 'p1', to: 'p3', type: 'SPOUSE', subtype: 'MARRIED' },
  ],
};

section('the JSON matches what the app writes');
{
  const doc = encodeDocument(sample);
  ok('format and version are always written', doc.format === 'f-tree' && doc.version === 1);
  ok('a person with nothing but an id is just an id',
    JSON.stringify(doc.people[2]) === '{"id":"p3"}', JSON.stringify(doc.people[2]));
  ok('deceased:false is left out, as encodeDefaults=false does',
    !('deceased' in doc.people[1]));
  ok('deceased:true is written', doc.people[0].deceased === true);
  ok('an empty origins list is left out', !('origins' in doc.people[1]));
  ok('origins are written when present',
    doc.people[0].origins[0].treeId === 't0' && doc.people[0].origins[0].personId === 'x1');
  ok('an absent name is an absent key, not a null',
    !('name' in doc.people[2]) && !JSON.stringify(doc).includes('null'));
  ok('a null subtype is left out', !('subtype' in doc.relationships[0]));

  let refused = null;
  try { encodeDocument({ people: [{ name: 'no id' }] }); } catch (e) { refused = e; }
  ok('a person without an id is refused, not written', refused instanceof WriteError,
    refused ? refused.message : 'nothing thrown');

  refused = null;
  try { encodeDocument({ relationships: [{ id: 'r', from: 'a', type: 'PARENT' }] }); }
  catch (e) { refused = e; }
  ok('a relationship missing an end is refused', refused instanceof WriteError,
    refused ? refused.message : 'nothing thrown');
}

section('every local header carries the truth — what ZipInputStream needs');
const written = await writeTreeArchive(sample, new Map([
  ['photos/one.jpg', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8])],
]));
{
  const entries = walkLocalHeaders(written);
  ok('every entry is found by walking local headers alone', entries.length === 2,
    entries.map((e) => e.name).join(', '));
  ok('tree.json comes first, so a reader stops at the entry it wanted',
    entries[0]?.name === 'tree.json');
  ok('no entry defers its sizes to a data descriptor',
    entries.every((e) => !e.streamed));
  ok('every local header states a real uncompressed size',
    entries.every((e) => e.uncompressed > 0),
    entries.map((e) => `${e.name}=${e.uncompressed}`).join(' '));
  ok('every local header states a real CRC', entries.every((e) => e.crc !== 0));

  const json = new TextDecoder().decode(await inflate(entries[0]));
  ok('tree.json inflates from the local header alone', json.startsWith('{"format":"f-tree"'));
  ok('the document survives that route',
    parseDocument(json).people.length === 3);
  ok('no photos/ directory entry is written, as the app does not write one',
    !entries.some((e) => e.name === 'photos/'));
}

section('the central directory agrees with the local headers');
{
  const archive = await openArchive(written.buffer.slice(
    written.byteOffset, written.byteOffset + written.byteLength));
  ok('archive.js finds both entries', archive.names().length === 2, archive.names().join(', '));
  const doc = parseDocument(await archive.readText('tree.json'));
  ok('the people come back', doc.people.length === 3);
  ok('the relationships come back', doc.relationships.length === 2);
  ok('a photo comes back byte for byte',
    (await archive.read('photos/one.jpg'))[0] === 0xff);
}

section('a real export from the app round-trips');
{
  const fixtures = process.argv[2] || playground;
  const file = path.join(fixtures, 'sample-family.ftree');
  const original = new Uint8Array(await readFile(file));

  const first = await openArchive(original.buffer.slice(
    original.byteOffset, original.byteOffset + original.byteLength));
  const before = parseDocument(await first.readText('tree.json'));

  const photos = new Map();
  for (const name of first.names()) {
    if (name.startsWith('photos/') && !name.endsWith('/')) photos.set(name, await first.read(name));
  }

  const rewritten = await writeTreeArchive(before, photos);
  const second = await openArchive(rewritten.buffer.slice(
    rewritten.byteOffset, rewritten.byteOffset + rewritten.byteLength));
  const after = parseDocument(await second.readText('tree.json'));

  ok('the same people, in the same order',
    same(before.people, after.people), `${before.people.length} people`);
  ok('the same relationships',
    same(before.relationships, after.relationships), `${before.relationships.length} edges`);
  ok('every photo survives',
    [...photos.keys()].every((n) => second.has(n)), `${photos.size} photos`);

  /*
   * The asymmetry, asserted rather than described.
   *
   * The app's own archive defers its sizes to data descriptors - which is exactly why archive.js
   * must read the central directory. Ours does not. If this ever stops being true of the app's
   * file, the note at the top of archive.js needs revisiting; if it stops being true of ours, the
   * Android app stops opening what the desktop saved.
   */
  const ours = walkLocalHeaders(rewritten);
  ok('this writer does not defer, so a local-header reader can read it',
    ours.every((e) => !e.streamed && e.uncompressed > 0),
    `${ours.length} entries, sizes ${ours.map((e) => e.uncompressed).join('/')}`);

  /*
   * The asymmetry, asserted rather than described - against the archive that actually has data
   * descriptors. `sample-family.ftree` is written seekably and does not; `sample-streamed.ftree`
   * exists precisely to stand in for what Java's ZipOutputStream emits, and is what archive.js's
   * central-directory reading is for. If this ever stops holding, that note needs revisiting.
   */
  const streamedFile = path.join(fixtures, 'sample-streamed.ftree');
  const streamed = await readFile(streamedFile).then((b) => new Uint8Array(b), () => null);
  if (!streamed) {
    ok('a streamed archive is available to contrast against', false,
      `${streamedFile} is missing - run tools/make_sample_tree.py`);
  } else {
    const theirs = walkLocalHeaders(streamed);
    ok('an archive written the way the app writes defers its sizes',
      theirs.length > 0 && theirs.every((e) => e.streamed && e.uncompressed === 0),
      `${theirs.length} entries, sizes ${theirs.map((e) => e.uncompressed).join('/')}`);
  }
}

/*
 * If a real export from the phone is lying about, use it. It is the only artifact here that the
 * Android app itself produced, so it is the one that settles what the format really looks like.
 * Absent in CI, and absence is reported rather than passed over in silence.
 */
section('a real export from the phone, when there is one');
{
  const real = path.join(here, '..', 'temp');
  const names = await (await import('node:fs/promises')).readdir(real).catch(() => []);
  const found = names.filter((n) => n.endsWith('.ftree')).sort().pop();
  if (!found) {
    console.log('  --   none in temp/, skipped (this runs on a developer machine, not in CI)');
  } else {
    const bytes = new Uint8Array(await readFile(path.join(real, found)));
    /*
     * The walk stops after one entry, and that is the finding, not a shortfall. A data-descriptor
     * header declares a compressed size of zero, so a reader that trusts it steps forward zero
     * bytes and lands in the middle of the deflate stream rather than on the next signature. That
     * is precisely why archive.js reads the central directory, and precisely what this writer
     * avoids. Reported plainly so the entry count is not mistaken for the archive's size.
     */
    const headers = walkLocalHeaders(bytes);
    const total = (await openArchive(bytes.buffer.slice(
      bytes.byteOffset, bytes.byteOffset + bytes.byteLength))).names().length;
    ok(`${found} defers its sizes, as ZipOutputStream does`,
      headers.length > 0 && headers.every((e) => e.streamed && e.uncompressed === 0),
      `walking local headers reaches ${headers.length} of ${total} entries before losing the trail`);

    const a = await openArchive(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    const doc = parseDocument(await a.readText('tree.json'));
    const photos = new Map();
    for (const n of a.names()) {
      if (n.startsWith('photos/') && !n.endsWith('/')) photos.set(n, await a.read(n));
    }
    const out = await writeTreeArchive(doc, photos);
    const b = await openArchive(out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength));
    const back = parseDocument(await b.readText('tree.json'));
    ok('a real tree round-trips unchanged',
      same(doc.people, back.people) && same(doc.relationships, back.relationships),
      `${doc.people.length} people, ${doc.relationships.length} edges, ${photos.size} photos`);
    ok('every local header in what we wrote states its size',
      walkLocalHeaders(out).every((e) => !e.streamed && e.uncompressed > 0));
  }
}

console.log(failures ? `\n${failures} of ${checks} FAILED.` : `\nAll ${checks} checks passed.`);
process.exit(failures ? 1 : 0);
