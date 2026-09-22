/*
 * art/procedural/{rangoli,toran,diyaRow}.js (#255): the seeded rangoli, toran and diya-row
 * generators. Checked for the things the issue and the design system make non-negotiable:
 * deterministic (seed.js's seeded(), nothing else), valid format-2 items, a repeated element is
 * one symbol placed many times, the diya row never invents or drops a person, and each generator's
 * estimated PDF cost is held to a measured ceiling so a regression here shows up as a failing test
 * rather than a surprise at print time (the book is already projected at 18.6 MB against 10 MB).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rangoli } from './art/procedural/rangoli.js';
import { toran } from './art/procedural/toran.js';
import { diyaRow } from './art/procedural/diyaRow.js';
import { LIBRARY, artFor } from './art/index.js';
import { createArt } from './art/draw.js';
import { PALETTE } from './art/style-frames/motifs.mjs';
import { PAPERCUT_PALETTE_KEYS } from './template.js';
import { formatOf, validateBook, PAGE } from './format.js';
import { artStats, artTerm } from './compose.js';
import { bannedApiViolations } from './qa/closure.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/*
 * The real paper-cut palette (motifs.mjs is the tokens' authoritative source, book-design-
 * system.md), lowercased: format.js's COLOUR only accepts lower-case hex (the real templates,
 * e.g. templates/diwali.json, already write it that way; motifs.mjs's own upper-case is just
 * that hand-authored reference file's habit, not a second convention this test should invent).
 */
const P = Object.fromEntries(PAPERCUT_PALETTE_KEYS.map((k) => [k, PALETTE[k].toLowerCase()]));
assert.ok(PAPERCUT_PALETTE_KEYS.every((k) => typeof P[k] === 'string'), 'the test palette is missing a token motifs.mjs should have');

/** A fresh `artFor`-shaped helper plus the defs it files, over the real compiled library. */
function kit(library = LIBRARY) {
  const defs = {};
  const ctx = { P, gradient: (id, def) => { defs[id] = def; return { ref: id }; } };
  return { art: createArt(ctx, library), defs };
}

/** A one-page book around some items, as the composer would hand a painter (art-draw.test.mjs). */
function bookOf(items, defs = {}, art = null) {
  const book = { size: { ...PAGE }, fonts: {}, defs, pages: [{ label: 'p', items: items.filter(Boolean) }] };
  const symbols = art?.symbols();
  if (symbols) book.symbols = symbols;
  return { format: formatOf(book), ...book };
}

const cost = (book) => artTerm(artStats(book));

/** Every `use` in an item tree, ref included, whatever depth it's nested at. */
function usesIn(item, out = []) {
  if (!item) return out;
  if (item.t === 'use') out.push(item);
  if (item.t === 'group') item.items.forEach((it) => usesIn(it, out));
  return out;
}

test('none of the three generators reach for anything but seed.js\'s seeded()', () => {
  const files = ['rangoli.js', 'toran.js', 'diyaRow.js', 'index.js'].map((f) => path.join(here, 'art/procedural', f));
  assert.deepEqual(bannedApiViolations(files), []);
});

// -------------------------------------------------------------------------------------------
// rangoli

test('rangoli is deterministic and format-2 valid, within its measured budget', () => {
  const a = rangoli(P, 300, 400, 90, 'Kumar family');
  const b = rangoli(P, 300, 400, 90, 'Kumar family');
  assert.deepEqual(a, b, 'the same seed must draw the same rangoli');
  const c = rangoli(P, 300, 400, 90, 'a different family');
  assert.notDeepEqual(a, c, 'a different seed must be free to draw a different rangoli');

  const book = bookOf([a]);
  assert.deepEqual(validateBook(book), []);
  assert.equal(book.format, 1, 'plain paths and circles never need format 2');

  const spent = cost(book);
  assert.ok(spent < 15_000, `rangoli grew from ~9.7 KB to ${Math.round(spent)} - update the budget comment if this is intended`);
});

test('rangoli never uses the "brass" token, reserved for name-not-known', () => {
  const seen = new Set();
  const walk = (it) => { if (it.fill && typeof it.fill === 'string') seen.add(it.fill); if (it.t === 'group') it.items.forEach(walk); };
  walk(rangoli(P, 0, 0, 50, 'x'));
  assert.ok(!seen.has(P.brass));
});

// -------------------------------------------------------------------------------------------
// toran

test('toran spaces more flowers across a wider span, never fewer, and each is the seeded symbol', () => {
  const { art, defs } = kit();
  const narrow = toran(art, P, 0, 60, 0, 'seed');
  const wide = toran(art, P, 0, 600, 0, 'seed');
  const countOf = (t) => usesIn(t).filter((u) => u.ref === 'pc-marigold').length;
  assert.ok(countOf(wide) > countOf(narrow));
  assert.ok(countOf(narrow) >= 1);

  const book = bookOf([wide], defs, art);
  assert.deepEqual(validateBook(book), []);
  assert.equal(book.format, 2, 'a toran uses the marigold symbol, so it must declare format 2');
});

test('toran hangs nothing across a span too short for even one flower', () => {
  const { art } = kit();
  assert.equal(toran(art, P, 10, 10.2, 0, 'seed'), null);
});

test('toran is deterministic', () => {
  const { art: art1 } = kit();
  const { art: art2 } = kit();
  assert.deepEqual(toran(art1, P, 0, 300, 0, 'door'), toran(art2, P, 0, 300, 0, 'door'));
});

test('a full page-width toran stays within its measured budget', () => {
  const { art, defs } = kit();
  const t = toran(art, P, 40, PAGE.w - 40, 40, 'header');
  const book = bookOf([t], defs, art);
  const spent = cost(book);
  assert.ok(spent < 230_000, `a page-width toran grew from ~177 KB to ${Math.round(spent)} - update the budget comment if this is intended`);
});

// -------------------------------------------------------------------------------------------
// diyaRow

test('diyaRow lights exactly as many lamps as it is told, never more, never fewer', () => {
  const { art, defs } = kit();
  for (const n of [1, 8, 12]) {
    const row = diyaRow(art, 50, 700, 545, 700, n, 'seed', { w: 20 });
    const lamps = usesIn(row).filter((u) => u.ref === 'pc-diya');
    assert.equal(lamps.length, n, `diyaRow(${n}) drew ${lamps.length} lamps`);
  }
  const book = bookOf([diyaRow(art, 0, 0, 500, 0, 8, 'seed')], defs, art);
  assert.deepEqual(validateBook(book), []);
});

test('diyaRow draws nothing, not an empty group, for zero people', () => {
  const { art } = kit();
  assert.equal(diyaRow(art, 0, 0, 100, 0, 0, 'seed'), null);
});

test('diyaRow refuses a count that could not be a number of people', () => {
  const { art } = kit();
  for (const bad of [-1, 1.5, NaN, '3']) {
    assert.throws(() => diyaRow(art, 0, 0, 100, 0, bad, 'seed'), /whole number of people/);
  }
});

test('a name-not-known lamp uses the dashed symbol once it exists, and falls back to today\'s lit diya until then', () => {
  const { art: withoutUnknown } = kit(); // the real library: no diya-unknown yet
  const rowNow = diyaRow(withoutUnknown, 0, 0, 100, 0, 3, 'seed', { unknownAt: new Set([1]) });
  assert.deepEqual(usesIn(rowNow).map((u) => u.ref), ['pc-diya', 'pc-diya', 'pc-diya']);

  // a library that already has the dashed variant, shaped the way art/index.js merges one
  const withUnknown = { symbols: { ...LIBRARY.symbols, 'diya-unknown': LIBRARY.symbols.diya }, gradients: LIBRARY.gradients };
  const { art: futureArt } = kit(withUnknown);
  const rowFuture = diyaRow(futureArt, 0, 0, 100, 0, 3, 'seed', { unknownAt: (i) => i === 1 });
  assert.deepEqual(usesIn(rowFuture).map((u) => u.ref), ['pc-diya', 'pc-diya-unknown', 'pc-diya']);
});

test('diyaRow is deterministic', () => {
  const { art: art1 } = kit();
  const { art: art2 } = kit();
  assert.deepEqual(diyaRow(art1, 0, 0, 400, 40, 12, 'family-42'), diyaRow(art2, 0, 0, 400, 40, 12, 'family-42'));
});

test('a family page and a gathering, at the design system\'s own caps, stay within their measured budgets', () => {
  const cases = [[8, 155_000], [12, 235_000]];
  for (const [n, ceiling] of cases) {
    const { art, defs } = kit();
    const book = bookOf([diyaRow(art, 40, 700, 555, 700, n, 'cap-test', { w: 20 })], defs, art);
    const spent = cost(book);
    assert.ok(spent < ceiling, `diyaRow(${n}) grew past its budget: ${Math.round(spent)} >= ${ceiling}`);
  }
});
