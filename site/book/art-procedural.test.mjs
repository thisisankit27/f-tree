/*
 * art/procedural/{rangoli,toran,diyaRow}.js (#255): the seeded rangoli, toran and diya-row
 * generators. Checked for the things the issue and the design system make non-negotiable:
 * deterministic (seed.js's seeded(), nothing else), valid format-2 items, a repeated element is
 * one symbol placed many times, the diya row never invents or drops a person, and each generator's
 * estimated PDF cost is held to a measured ceiling so a regression here shows up as a failing test
 * rather than a surprise at print time (the book is already projected at 18.6 MB against 10 MB).
 *
 * Round 1 (design critic) added: the outer accent dots must sit in the gaps between petals, not on
 * a tip; the outer petal count must actually vary by seed (16/20/24); the colours' role order must
 * vary by seed; the second petal ring must contrast with the card ground; small rangolis keep a
 * dot floor radius; the ground is a wobbled cut shape, not a perfect circle; the toran hangs mango
 * leaves (marigolds only every other slot, never a marigold-only string, which is the book's
 * marriage notation); and the toran's sag scales with the span, not with the flower size.
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
const TAU = Math.PI * 2;

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

/** Every number in a path's `d`, paired up as (x, y) - true for every command rangoli.js writes. */
function coordsOf(d) {
  const nums = d.match(/-?\d+\.?\d*/g).map(Number);
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push([nums[i], nums[i + 1]]);
  return pts;
}

/**
 * rangoli()'s outer petal count, recovered from the item count alone: items are laid down in a
 * fixed order (2 ground + outer ring x2 + 48 dots + mid ring + inner ring + 2 centre + outer
 * accent dots), so the total length pins down which of the three seeded counts (16/20/24) it was.
 */
function outerCountOf(items) {
  const oc = [16, 20, 24].find((n) => 52 + 3 * n + Math.round(n / 2) + Math.round(n / 3) === items.length);
  assert.ok(oc, `item count ${items.length} doesn't match any seeded outer petal count`);
  return oc;
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
  assert.ok(spent < 20_000, `rangoli grew from ~13 KB to ${Math.round(spent)} - update the budget comment if this is intended`);
});

test('rangoli never uses the "brass" token, reserved for name-not-known', () => {
  const seen = new Set();
  const walk = (it) => { if (it.fill && typeof it.fill === 'string') seen.add(it.fill); if (it.t === 'group') it.items.forEach(walk); };
  walk(rangoli(P, 0, 0, 50, 'x'));
  assert.ok(!seen.has(P.brass));
});

test('rangoli seeds its outer petal count across all three tasteful options (round 1)', () => {
  const seen = new Set();
  for (let i = 0; i < 60; i++) seen.add(outerCountOf(rangoli(P, 0, 0, 90, `seed-${i}`).items));
  assert.deepEqual([...seen].sort((x, y) => x - y), [16, 20, 24]);
});

test('rangoli seeds the colours\' role order across the rings (round 1)', () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) seen.add(rangoli(P, 0, 0, 90, `c-${i}`).items[2].fill);
  assert.ok(seen.size > 1, 'every family got the same colour in the same ring - the seed never rotates the colour order');
});

test('rangoli\'s outer accent dots sit in the gaps between petals, never on a tip (round 1)', () => {
  const cx = 300, cy = 400, R = 90;
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'Kumar family', 'Devi household']) {
    const { items } = rangoli(P, cx, cy, R, seed);
    const oc = outerCountOf(items);
    const ring1 = items.slice(2, 2 + oc);
    const accent = items.slice(items.length - oc);
    const petalAngles = ring1.map((it) => {
      const tip = coordsOf(it.d).reduce((best, p) => (Math.hypot(p[0] - cx, p[1] - cy) > Math.hypot(best[0] - cx, best[1] - cy) ? p : best));
      return Math.atan2(tip[1] - cy, tip[0] - cx);
    });
    const spacing = TAU / oc;
    for (const dot of accent) {
      const a = Math.atan2(dot.cy - cy, dot.cx - cx);
      const nearest = Math.min(...petalAngles.map((pa) => Math.abs(Math.atan2(Math.sin(a - pa), Math.cos(a - pa)))));
      assert.ok(nearest > spacing * 0.3, `seed ${seed}: an accent dot sits ${nearest.toFixed(3)} rad from a petal tip (spacing ${spacing.toFixed(3)})`);
    }
  }
});

test('the second petal ring contrasts with the card ground instead of matching it (round 1)', () => {
  const { items } = rangoli(P, 300, 400, 90, 'seed');
  const oc = outerCountOf(items);
  const ring2 = items.slice(2 + oc, 2 + 2 * oc);
  assert.ok(ring2.every((it) => it.fill === P.gold), 'the gap ring should be gold, not the card ground it would vanish against');
});

test('the ground is a seeded wobbled cut shape, not a perfect circle (round 1)', () => {
  const cx = 300, cy = 400, R = 90;
  const { items } = rangoli(P, cx, cy, R, 'seed');
  const [shadowItem, groundItem] = items;
  assert.equal(groundItem.t, 'path');
  assert.equal(shadowItem.t, 'path');
  const dists = coordsOf(groundItem.d).map(([x, y]) => Math.hypot(x - cx, y - cy));
  assert.ok(Math.max(...dists) - Math.min(...dists) > 0.5, 'the ground edge measures as a perfect circle');
  assert.ok(Math.max(...dists) - R * 1.02 < R * 0.05 && R * 1.02 - Math.min(...dists) < R * 0.05, 'the wobble should stay tasteful, not huge');
});

test('at a small radius, the dot rings keep a floor radius rather than vanishing (round 1)', () => {
  const { items } = rangoli(P, 0, 0, 20, 'seed');
  const oc = outerCountOf(items);
  const dotRing = items.slice(2 + 2 * oc, 2 + 2 * oc + 48);
  assert.ok(dotRing.every((it) => it.r >= 0.8), 'the 48-dot ring should not shrink below a visible floor radius');
});

// -------------------------------------------------------------------------------------------
// toran

test('toran hangs a leaf at every slot and a marigold at every other one, more of both across a wider span', () => {
  const { art, defs } = kit();
  const narrow = toran(art, P, 0, 60, 0, 'seed');
  const wide = toran(art, P, 0, 600, 0, 'seed');
  const countOf = (t, ref) => usesIn(t).filter((u) => u.ref === ref).length;
  assert.ok(countOf(wide, 'pc-mango-leaf') > countOf(narrow, 'pc-mango-leaf'));
  assert.ok(countOf(narrow, 'pc-mango-leaf') >= 1);
  // a marigold-only string is the marriage notation (a mala between two frames): there must be
  // more leaves than flowers, never a run of marigolds alone.
  const leaves = countOf(wide, 'pc-mango-leaf'), flowers = countOf(wide, 'pc-marigold');
  assert.ok(flowers > 0 && flowers < leaves, `expected fewer marigolds than leaves, got ${flowers} vs ${leaves}`);

  const book = bookOf([wide], defs, art);
  assert.deepEqual(validateBook(book), []);
  assert.equal(book.format, 2, 'a toran uses the mango-leaf and marigold symbols, so it must declare format 2');
});

test('toran alternates leaf and leafDeep by tint, at no extra symbol cost (round 2)', () => {
  const { art } = kit();
  const t = toran(art, P, 0, 300, 0, 'seed');
  // op is only ever set on a shadow use (art/draw.js SHADOW.op); the un-shadowed, tinted leaf
  // itself carries no op, so this excludes the ink-filled shadow copies from the fill check.
  const leafFills = usesIn(t).filter((u) => u.ref === 'pc-mango-leaf' && u.op === undefined).map((u) => u.fill);
  assert.ok(leafFills.length > 0);
  assert.ok(leafFills.every((f) => f === P.leaf || f === P.leafDeep));
  assert.ok(new Set(leafFills).size === 2, 'both leaf and leafDeep should appear');
});

test('toran hangs nothing across a span too short for even one leaf', () => {
  const { art } = kit();
  assert.equal(toran(art, P, 10, 10.2, 0, 'seed'), null);
});

test('toran is deterministic', () => {
  const { art: art1 } = kit();
  const { art: art2 } = kit();
  assert.deepEqual(toran(art1, P, 0, 300, 0, 'door'), toran(art2, P, 0, 300, 0, 'door'));
});

test('the toran\'s sag scales with the span, not the flower size (round 1: 0.35w read as a wobbly straight line)', () => {
  const { art } = kit();
  const dipOf = (t) => Math.max(...coordsOf(t.items[0].d).map(([, y]) => y));
  assert.ok(Math.abs(dipOf(toran(art, P, 0, 100, 0, 'x')) - 100 * 0.03) < 0.5);
  assert.ok(Math.abs(dipOf(toran(art, P, 0, 500, 0, 'x')) - 500 * 0.03) < 1);
});

test('a full page-width toran (round 3: cover-scale leaves) stays within its measured budget', () => {
  const { art, defs } = kit();
  const t = toran(art, P, 40, PAGE.w - 40, 40, 'header');
  const book = bookOf([t], defs, art);
  const spent = cost(book);
  assert.ok(spent < 200_000, `a page-width toran grew from ~168 KB to ${Math.round(spent)} - update the budget comment if this is intended`);
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

test('a name-not-known lamp uses #253\'s lamp-unknown symbol, not a plain lit diya', () => {
  const { art, defs } = kit();
  const row = diyaRow(art, 0, 0, 100, 0, 3, 'seed', { unknownAt: new Set([1]) });
  assert.deepEqual(usesIn(row).map((u) => u.ref), ['pc-diya', 'pc-lamp-unknown', 'pc-diya']);
  const book = bookOf([row], defs, art);
  assert.deepEqual(validateBook(book), []);
});

test('diyaRow is deterministic', () => {
  const { art: art1 } = kit();
  const { art: art2 } = kit();
  assert.deepEqual(diyaRow(art1, 0, 0, 400, 40, 12, 'family-42'), diyaRow(art2, 0, 0, 400, 40, 12, 'family-42'));
});

test('a family page and a gathering, at the design system\'s own caps, stay within their measured budgets', () => {
  const cases = [[8, 155_000], [12, 230_000]];
  for (const [n, ceiling] of cases) {
    const { art, defs } = kit();
    const book = bookOf([diyaRow(art, 40, 700, 555, 700, n, 'cap-test', { w: 20 })], defs, art);
    const spent = cost(book);
    assert.ok(spent < ceiling, `diyaRow(${n}) grew past its budget: ${Math.round(spent)} >= ${ceiling}`);
  }
});
