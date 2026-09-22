/*
 * Every family and every template the QA harness (#245) runs the book over.
 *
 * Both lists are read off the disk, not written out here, so a fixture added to site/book/fixtures
 * or a template added to site/book/templates is covered the day it lands - including the storybook's
 * hidden `diwali-story` template, which the invariant suite picks up on its own once it exists.
 * The storybook fixtures (`story-*.json`) come from `tools/make_sample_tree.py --book-fixtures`;
 * `storybook.json` describes them.
 *
 * book.test.mjs keeps its own fixed list on purpose: that list is what golden.txt hashes, and
 * Heirloom's goldens must not move when a fixture is added.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openArchive, parseDocument } from '../../playground/archive.js';

const book = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const NOW = '2026-09-15';

/** Fixture name -> where it comes from. `sample` is the playground's own archive. */
export const BOOK_FIXTURES = Object.fromEntries([
  ['sample', { archive: path.join(book, '../playground/sample-family.ftree') }],
  ...readdirSync(path.join(book, 'fixtures'))
    .filter((f) => f.endsWith('.json') && f !== 'storybook.json')
    .sort()
    .map((f) => [f.replace(/\.json$/, ''), { json: path.join(book, 'fixtures', f) }]),
]);

/** What `storybook.json` says about each generated fixture, by fixture name. */
export const STORYBOOK_MANIFEST = Object.fromEntries(
  Object.entries(JSON.parse(readFileSync(path.join(book, 'fixtures/storybook.json'), 'utf8')).fixtures)
    .map(([file, about]) => [file.replace(/\.json$/, ''), about]),
);

/** The fixture's .ftree archive, for the one fixture that is an archive; null for the rest. */
export async function openFixtureArchive(name) {
  const f = BOOK_FIXTURES[name];
  if (!f) throw new Error(`no book fixture "${name}"`);
  if (!f.archive) return null;
  const buf = readFileSync(f.archive);
  return openArchive(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

export async function loadFixture(name) {
  const archive = await openFixtureArchive(name);
  if (archive) return parseDocument(await archive.readText('tree.json'));
  return JSON.parse(readFileSync(BOOK_FIXTURES[name].json, 'utf8'));
}

/** Template id -> template document, for every template file the release carries. */
export const TEMPLATES = Object.fromEntries(
  readdirSync(path.join(book, 'templates'))
    .filter((f) => f.endsWith('.json') && f !== 'catalog.json')
    .sort()
    .map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(path.join(book, 'templates', f), 'utf8'))]),
);
