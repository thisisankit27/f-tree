/*
 * art/draw.js (#247): placing compiled paper-cut art. The placement maths, the paper shadow, the
 * frame's clip, and the promise that a book carries exactly the symbols it used - checked against
 * a small hand-built library, and against the real one through validateBook and svg.js.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createArt, anchorPoint, apply, SHADOW, SYMBOL_PREFIX } from './art/draw.js';
import { LIBRARY, artFor } from './art/index.js';
import { seeded } from './art/seed.js';
import { validateBook, formatOf, PAGE, rect } from './format.js';
import { paintPage } from './svg.js';
import { PAPERCUT_PALETTE_KEYS } from './template.js';
import { importClosure, bannedApiViolations, stripComments } from './qa/closure.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

/** A palette with every paper-cut token, each its own colour. */
const P = Object.fromEntries(PAPERCUT_PALETTE_KEYS.map((k, i) => [k, `#${(0x100000 + i * 0x0a0b0c).toString(16).slice(-6)}`]));

/** A tiny library: a 20 x 10 box anchored bottom-centre, a frame with an opening, a part. */
const LIB = {
  symbols: {
    box: { kind: 'motif', vb: [0, 0, 20, 10], anchor: [10, 10], zones: [{ kind: 'text', x: 0, y: 0, w: 5, h: 10 }], items: [{ t: 'rect', x: 0, y: 0, w: 20, h: 10, fill: 'clay' }, { t: 'use', ref: 'box--dot' }] },
    'box--dot': { items: [{ t: 'circle', cx: 5, cy: 5, r: 1, fill: { ref: 'box-g0' }, stroke: 'ink', sw: 0.5 }] },
    arch: { kind: 'frame', vb: [-10, -10, 60, 80], anchor: [20, 70], clip: 'M0 0L40 0 40 60 0 60Z', opening: [0, 0, 40, 60], items: [{ t: 'path', d: 'M-10 -10L50 -10 50 70 -10 70ZM0 0L0 60 40 60 40 0Z', fill: 'stone', rule: 'evenodd' }] },
    lone: { kind: 'motif', vb: [0, 0, 1, 1], anchor: [0, 0], items: [{ t: 'rect', x: 0, y: 0, w: 1, h: 1, fill: 'gold' }] },
  },
  gradients: { 'box-g0': { type: 'radial', units: 'item', cx: 0, cy: 0, r: 1, stops: [[0, 'gold'], [1, 'gold', 0]] } },
};

function kit(library = LIB) {
  const defs = {};
  const ctx = { P, gradient: (id, def) => { defs[id] = def; return { ref: id }; } };
  return { art: createArt(ctx, library), defs };
}

/** A one-page book around some items, as the composer would hand it to a painter. */
function bookOf(items, art, defs) {
  const book = { size: { ...PAGE }, fonts: {}, defs, pages: [{ label: 'p', items }] };
  const symbols = art.symbols();
  if (symbols) book.symbols = symbols;
  return { format: formatOf(book), ...book };
}

/** A book's first page as svg.js paints it. */
const paint = (book) => paintPage(book, 0, { photo: () => null, font: (k) => k });

const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a} vs ${b}`));

test('place puts the drawing\'s anchor on (x, y), sized by w, h or s', () => {
  const { art } = kit();
  near(art.place('box', { x: 100, y: 200, w: 40 }).tf, [2, 0, 0, 2, 80, 180]);
  near(art.place('box', { x: 100, y: 200, h: 5 }).tf, [0.5, 0, 0, 0.5, 95, 195]);
  near(art.place('box', { x: 100, y: 200 }).tf, [1, 0, 0, 1, 90, 190], 'one point per viewBox unit by default');
  near(art.place('box', { x: 100, y: 200, s: 3, anchor: 'top-left' }).tf, [3, 0, 0, 3, 100, 200]);
  near(art.place('box', { x: 0, y: 0, anchor: [20, 0] }).tf, [1, 0, 0, 1, -20, 0]);
  // a viewBox that does not start at the origin
  near(art.place('arch', { x: 0, y: 0, w: 120 }).tf, [2, 0, 0, 2, -40, -140]);
  assert.deepEqual(art.box('box', { x: 100, y: 200, w: 40 }), { x: 80, y: 180, w: 40, h: 20 });
  assert.throws(() => art.place('box', { x: 0, y: 0, w: 1, h: 1 }), /one of w, h or s, not w and h/);
  assert.throws(() => art.place('box', { x: 0, y: 0, w: 0 }), /scale 0/);
  assert.throws(() => art.place('box', { y: 0 }), /x and y are required/);
  assert.throws(() => art.place('nope', { x: 0, y: 0 }), /no drawing called "nope"/);
  assert.throws(() => art.place('box--dot', { x: 0, y: 0 }), /a part of another drawing/);
});

test('flip mirrors the drawing inside the box it would have filled', () => {
  const { art } = kit();
  const at = { x: 100, y: 200, w: 40, anchor: 'top-left' };
  const map = (tf, x, y) => [tf[0] * x + tf[2] * y + tf[4], tf[1] * x + tf[3] * y + tf[5]];
  for (const flip of ['x', true, 'y', 'xy']) {
    const { tf } = art.place('box', { ...at, flip });
    const corners = [[0, 0], [20, 10]].map(([x, y]) => map(tf, x, y));
    const xs = corners.map((c) => c[0]).sort((a, b) => a - b), ys = corners.map((c) => c[1]).sort((a, b) => a - b);
    assert.deepEqual([xs, ys], [[100, 140], [200, 220]], `flip ${flip} stays in the box`);
  }
  near(art.place('box', { ...at, flip: 'x' }).tf, [-2, 0, 0, 2, 140, 200]);
  near(art.place('box', { ...at, flip: 'y' }).tf, [2, 0, 0, -2, 100, 220]);
  assert.throws(() => art.place('box', { ...at, flip: 'z' }), /flip "z"/);
});

test('anchors name the nine points of the viewBox', () => {
  const vb = [10, 20, 100, 50];
  assert.deepEqual(anchorPoint(vb, 'top-left'), [10, 20]);
  assert.deepEqual(anchorPoint(vb, 'center'), [60, 45]);
  assert.deepEqual(anchorPoint(vb, 'bottom-center'), [60, 70]);
  assert.deepEqual(anchorPoint(vb, 'center-right'), [110, 45]);
  assert.throws(() => anchorPoint(vb, 'middle'), /anchor "middle"/);
  assert.throws(() => anchorPoint(vb, 'top-left-ish'), /anchor "top-left-ish"/);
});

test('the paper shadow is the same shape, offset, in ink at about a fifth: one use, or three fading', () => {
  const { art, defs } = kit();
  const hard = art.place('box', { x: 100, y: 200, w: 40, shadow: true });
  assert.equal(hard.t, 'group');
  const [shadow, drawing] = hard.items;
  assert.deepEqual(shadow, { t: 'use', ref: 'pc-box', tf: [2, 0, 0, 2, 80 + SHADOW.dx, 180 + SHADOW.dy], fill: P.ink, op: SHADOW.op });
  assert.deepEqual(drawing, { t: 'use', ref: 'pc-box', tf: [2, 0, 0, 2, 80, 180] });
  assert.ok(SHADOW.dx === 1.7 && SHADOW.dy === 2.3 && SHADOW.op >= 0.2 && SHADOW.op <= 0.25);

  const soft = art.place('box', { x: 0, y: 0, shadow: 'soft' });
  assert.equal(soft.items.length, 4);
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  assert.deepEqual(soft.items.slice(0, 3).map((u) => [r4(u.tf[4] + 10), r4(u.tf[5] + 10), u.op]), [[5.1, 6.9, 0.08], [3.4, 4.6, 0.07], [1.7, 2.3, 0.1]]);
  const custom = art.place('box', { x: 0, y: 0, shadow: { dx: 0.5, dy: 1, op: 0.3, colour: 'deep' } });
  assert.deepEqual([custom.items[0].tf[4], custom.items[0].fill, custom.items[0].op], [-9.5, P.deep, 0.3]);
  // silhouettes are what format 2 draws: this whole page validates, and svg.js paints it
  const book = bookOf([hard, soft, custom, art.place('box', { x: 9, y: 9, tint: 'rani', op: 0.5 })], art, defs);
  assert.deepEqual(validateBook(book), []);
  const page = paint(book);
  assert.match(page, new RegExp(`fill="${P.ink}"`));
  assert.throws(() => art.place('box', { x: 0, y: 0, shadow: { dx: 'far' } }), /shadow\.dx is not a number/);
});

test('tint draws the whole drawing in one palette colour; op is one layer over it', () => {
  const { art } = kit();
  assert.deepEqual(art.place('box', { x: 10, y: 10, tint: 'rani', op: 0.5 }), { t: 'use', ref: 'pc-box', tf: [1, 0, 0, 1, 0, 0], fill: P.rani, op: 0.5 });
  assert.throws(() => art.place('box', { x: 0, y: 0, tint: 'pink' }), /palette token "pink"/);
});

test('zones come back in page points, wherever and however the drawing is placed', () => {
  const { art } = kit();
  assert.deepEqual(art.zones('box', { x: 100, y: 200, w: 40 }), [{ kind: 'text', x: 80, y: 180, w: 10, h: 20 }]);
  assert.deepEqual(art.zones('box', { x: 100, y: 200, w: 40, flip: 'x' }), [{ kind: 'text', x: 110, y: 180, w: 10, h: 20 }], 'a flipped drawing\'s zone flips with it');
  assert.deepEqual(art.zones('lone', { x: 0, y: 0 }), []);
  assert.equal(art.symbols(), undefined, 'asking where zones are draws nothing');
});

test('frame clips the inner items to the opening, inside the frame\'s own transform, and draws the frame over the clip edge', () => {
  const { art, defs } = kit();
  const inner = [rect(0, 0, 595, 842, { fill: P.sky })];
  const g = art.frame('arch', { x: 100, y: 100, w: 80, h: 120 }, inner);
  assert.equal(g.t, 'group');
  assert.deepEqual(g.tf, [2, 0, 0, 2, 100, 100], 'the opening, fitted to the box');
  const [clipped, ...framed] = g.items;
  assert.equal(clipped.clip, LIB.symbols.arch.clip, 'the compiled opening as it is: a group clip lies inside the group transform');
  // the inner items are page points, carried back through the inverse so they land where they were
  const [back] = clipped.items;
  assert.deepEqual(back.items, inner);
  near(apply(g.tf, ...apply(back.tf, 123, 456)), [123, 456]);
  // the soft shadow, offset in page points: 1.7 and 2.3 points are 0.85 and 1.15 of the frame's units
  assert.deepEqual(framed.map((u) => u.tf ?? null), [[1, 0, 0, 1, 2.55, 3.45], [1, 0, 0, 1, 1.7, 2.3], [1, 0, 0, 1, 0.85, 1.15], null]);
  assert.deepEqual(framed.at(-1), { t: 'use', ref: 'pc-arch' });
  // contain keeps proportion and centres; stretch fills the box
  assert.deepEqual(art.frame('arch', { x: 0, y: 0, w: 80, h: 60 }, inner, { shadow: false }).tf, [1, 0, 0, 1, 20, 0]);
  assert.deepEqual(art.frame('arch', { x: 0, y: 0, w: 80, h: 60 }, inner, { shadow: false, fit: 'stretch' }).tf, [2, 0, 0, 1, 0, 0]);
  assert.deepEqual(art.frame('arch', { x: 0, y: 0, w: 40, h: 60 }, [], { shadow: false }).items, [{ t: 'use', ref: 'pc-arch' }], 'nothing to clip, no clip');
  assert.throws(() => art.frame('box', { x: 0, y: 0, w: 1, h: 1 }, inner), /"box" has no opening/);
  assert.throws(() => art.frame('arch', { x: 0, y: 0, w: 0, h: 1 }, inner), /positive size/);
  assert.throws(() => art.frame('arch', { x: 0, y: 0, w: 1, h: 1 }, inner, { fit: 'cover' }), /fit "cover"/);
  assert.deepEqual(validateBook(bookOf([g], art, defs)), []);
  // svg.js puts the clip inside the transform, as Android's save / concat / clipPath does
  assert.match(paint(bookOf([g], art, defs)), /<g transform="matrix\(2 0 0 2 100 100\)"><g clip-path="url\(#p0-clip0\)">/);
});

test('a book carries exactly the symbols it used, their parts, and nothing else - never an empty map', () => {
  const { art, defs } = kit();
  assert.equal(art.symbols(), undefined);
  const book0 = bookOf([rect(0, 0, 1, 1, { fill: P.paper })], art, defs);
  assert.equal(book0.symbols, undefined);
  assert.equal(book0.format, 1, 'a book that places no art stays format 1');

  art.place('box', { x: 0, y: 0 });
  art.place('box', { x: 5, y: 5, shadow: true });
  const symbols = art.symbols();
  assert.deepEqual(Object.keys(symbols), ['pc-box', 'pc-box--dot'], 'the part comes with it; lone and arch were never placed');
  // tokens are resolved against the palette, gradients filed in defs under the prefixed id
  assert.equal(symbols['pc-box'].items[0].fill, P.clay);
  assert.equal(symbols['pc-box'].items[1].ref, 'pc-box--dot');
  assert.deepEqual(symbols['pc-box--dot'].items[0].fill, { ref: 'pc-box-g0' });
  assert.equal(symbols['pc-box--dot'].items[0].stroke, P.ink);
  assert.deepEqual(defs['pc-box-g0'].stops, [[0, P.gold], [1, P.gold, 0]]);
  assert.ok(Object.keys(symbols).every((k) => k.startsWith(SYMBOL_PREFIX)));
  // the library itself is never written to
  assert.equal(LIB.symbols.box.items[0].fill, 'clay');
});

test('a palette missing a token the art uses fails, naming the token', () => {
  const { gold: _gold, ...partial } = P;
  const art = createArt({ P: partial, gradient: (id) => ({ ref: id }) }, LIB);
  assert.throws(() => art.place('lone', { x: 0, y: 0 }), /"lone" uses the palette token "gold", which this template's palette does not define/);
});

test('the seeded art places, shadows and frames into a book that validates and paints', () => {
  const defs = {};
  const art = artFor({ P, gradient: (id, def) => { defs[id] = def; return { ref: id }; } });
  for (const id of ['diya', 'marigold', 'arch-jharokha']) assert.ok(art.has(id), id);
  const items = [
    art.frame('arch-jharokha', { x: 200, y: 180, w: 192, h: 250 }, [rect(150, 150, 300, 300, { fill: P.sky })]),
    art.place('diya', { x: 225, y: 432, w: 22 }),
    art.place('diya', { x: 372, y: 432, w: 22, flip: 'x' }),
    art.place('marigold', { x: 300, y: 190, w: 13, shadow: true }),
  ];
  const book = bookOf(items, art, defs);
  assert.deepEqual(validateBook(book), []);
  assert.deepEqual(Object.keys(book.symbols), ['pc-arch-jharokha', 'pc-diya', 'pc-diya-bowl', 'pc-diya-flame', 'pc-diya-glow', 'pc-diya-small', 'pc-marigold'], 'the diya brings the cuts it shares with the other lamps');
  assert.equal(book.format, 2);
  assert.match(paint(book), /<svg/);
  const { symbols } = LIBRARY;
  assert.equal(symbols['arch-jharokha'].kind, 'frame');
  assert.ok(symbols['arch-jharokha'].clip && symbols['arch-jharokha'].opening);
});

test('the departed\'s mala is placed only when the page says the person has died', () => {
  const art = artFor({ P, gradient: (id) => ({ ref: id }) });
  assert.throws(() => art.place('mala-departed', { x: 0, y: 0 }), /"mala-departed" is only for a person who has died - pass \{ departed: true \}/);
  assert.throws(() => art.place('mala-departed', { x: 0, y: 0, departed: 'yes' }), /only for a person who has died/);
  assert.equal(art.place('mala-departed', { x: 0, y: 0, departed: true }).ref, 'pc-mala-departed');
});

test('seeded() in art/seed.js is the generator blocks/art.js always used', () => {
  // the first three draws for this seed, taken from blocks/art.js on main before the move
  const r = seeded('family:ch1:p42');
  assert.deepEqual([r(), r(), r()].map((v) => Math.round(v * 1e9)), [407217673, 113194933, 426290741]);
});

test('art/index.js reaches every module by static import, and the art modules are composer-safe', () => {
  const src = stripComments(readFileSync(path.join(here, 'art', 'index.js'), 'utf8'));
  assert.doesNotMatch(src, /\bimport\s*\(/, 'no dynamic import(): Android\'s staging walk cannot see one');
  const closure = importClosure(path.join(here, 'art', 'index.js'));
  const files = closure.map((f) => path.relative(here, f).split(path.sep).join('/'));
  for (const kind of ['scenes', 'avatars', 'frames', 'motifs', 'ornaments']) assert.ok(files.includes(`art/papercut/${kind}.js`), kind);
  assert.ok(files.includes('art/draw.js'));
  const repoRoot = path.resolve(here, '..', '..');
  assert.deepEqual(bannedApiViolations(closure, { repoRoot }), []);
  assert.deepEqual(bannedApiViolations(importClosure(path.join(here, 'art', 'seed.js')), { repoRoot }), []);
});
