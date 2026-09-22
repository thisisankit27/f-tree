/*
 * #253's assets: frames, avatars, lamps, flora and ornaments, and the choice of avatar. The compiler
 * holds each drawing to its budget (art-compiler.test.mjs); this holds the set to the design
 * system's rules. How the art looks is reviewed by eye: tools/book_art_specimen.mjs.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { LIBRARY, artFor } from './art/index.js';
import { avatarFor, heroFor, lifeStage, genderOf, GENDERS, STAGES, VARIANTS } from './story/avatars.js';
import { validateBook, formatOf, pathPoints, PAGE, rect } from './format.js';
import { paintPage } from './svg.js';
import { PAPERCUT_PALETTE_KEYS } from './template.js';

const { symbols } = LIBRARY;
const drawings = (kind) => Object.keys(symbols).filter((id) => symbols[id].kind === kind);
const ROUND_FRAMES = ['medallion', 'cameo', 'medallion-carved', 'medallion-petals'];

/** Every item a drawing draws, down through its parts and the drawings it places. */
function* walk(items, seen = new Set()) {
  for (const it of items) {
    yield it;
    if (it.t === 'group') yield* walk(it.items, seen);
    if (it.t === 'use' && !seen.has(it.ref)) { seen.add(it.ref); yield* walk(symbols[it.ref].items, seen); }
  }
}

test('every avatar and hero the chooser can name is a drawing, with a face zone on the busts', () => {
  for (const g of GENDERS) {
    for (const st of STAGES) {
      for (const v of VARIANTS) {
        const id = `avatar-${g}-${st}-${v}`;
        assert.equal(symbols[id]?.kind, 'avatar', id);
        assert.ok(symbols[id].zones.some((z) => z.kind === 'face'), `${id} marks where its face is`);
      }
      const hero = `hero-${g}-${st === 'youth' ? 'adult' : st}`;
      assert.equal(symbols[hero]?.kind, 'avatar', hero);
    }
  }
});

test('the avatar is chosen from the record alone, and the same id always gets the same variant', () => {
  const ctx = { year: 2026 };
  const p = { id: 'p42', gender: 'FEMALE', by: 1950, dy: null };
  const first = avatarFor(p, ctx);
  for (let i = 0; i < 5; i++) assert.equal(avatarFor({ ...p }, { ...ctx }), first);
  assert.equal(first, avatarFor({ ...p, gender: 'FEMALE' }, { year: 2026, gen: 3 }), 'a recorded year beats the generation');
  // across many ids both variants are used, and each id keeps its own
  const seen = new Set(Array.from({ length: 64 }, (_, i) => avatarFor({ id: `id${i}`, gender: 'MALE', by: 1990 }, ctx).slice(-1)));
  assert.deepEqual([...seen].sort(), ['a', 'b']);
  assert.equal(avatarFor({ id: 'x', gender: 'MALE', by: 1990 }, ctx), avatarFor({ id: 'x', gender: 'MALE', by: 1990 }, ctx));
});

test('life stage: birth year against the book\'s year, the departed as they were, else the generation', () => {
  const y = { year: 2026 };
  assert.deepEqual([2020, 2000, 1980, 1950].map((by) => lifeStage({ by }, y)), ['child', 'youth', 'adult', 'elder']);
  assert.equal(lifeStage({ by: 1900, dy: 1925 }, y), 'youth', 'a young man who died young is not drawn old');
  assert.equal(lifeStage({}, { year: 2026, gen: -2, featuredBy: 1995 }), 'elder', 'grandparents of a 31-year-old');
  assert.equal(lifeStage({}, { year: 2026, gen: 1, featuredBy: 1950 }), 'adult', 'children of a 76-year-old');
  assert.equal(lifeStage({}, { year: 2026, gen: 1, featuredBy: 2000 }), 'child');
  assert.equal(lifeStage({}, { year: 2026 }), 'adult', 'nothing known: adult');
  assert.throws(() => lifeStage({ by: 1990 }, {}), /the book's year is required/);
  assert.deepEqual(['FEMALE', 'MALE', 'UNSPECIFIED', 'OTHER', undefined].map((gender) => genderOf({ gender })), ['female', 'male', 'person', 'person', 'person']);
  assert.equal(heroFor({ id: 'h', gender: 'MALE', by: 2001 }, y), 'hero-male-adult', 'youth and adult share the hero');
});

test('every frame strokes its whole clip edge with a solid line: Android never shows a bare clip', () => {
  const frames = drawings('frame');
  for (const id of ['arch-jharokha', ...ROUND_FRAMES]) assert.ok(frames.includes(id), id);
  for (const id of frames) {
    const f = symbols[id];
    assert.ok(f.clip, `${id} has an opening`);
    assert.ok(f.zones?.some((z) => z.kind === 'face'), `${id} marks the face's safe area`);
    const [ox, oy, ow, oh] = f.opening;
    const covers = f.items.some((it) => it.stroke && it.sw >= 1 && !it.dash && (it.op ?? 1) === 1
      && (it.t === 'path' ? it.d === f.clip
        : it.t === 'circle' && Math.abs(it.cx - (ox + ow / 2)) < 0.01 && Math.abs(it.cy - (oy + oh / 2)) < 0.01 && Math.abs(it.r - ow / 2) < 0.01));
    assert.ok(covers, `${id}: no solid stroke along its clip edge`);
  }
});

test('brass means name not known and nothing else', () => {
  const unknown = new Set(['aala', 'lamp-unknown']);
  for (const [id, s] of Object.entries(symbols)) {
    if (!s.vb) continue;
    const brass = [...walk(s.items)].some((it) => it.fill === 'brass' || it.stroke === 'brass');
    assert.equal(brass, unknown.has(id), `${id} ${brass ? 'uses' : 'lacks'} brass`);
  }
});

test('the departed\'s mala hangs beneath its own frame, never over the portrait or towards anyone', () => {
  const mala = symbols['mala-departed'];
  assert.deepEqual(mala.anchor, [50, 50], 'placed on the frame\'s centre, in the round frames\' units');
  const pts = [...walk(mala.items)].filter((it) => it.t === 'path').flatMap((it) => pathPoints(it.d));
  for (const [x, y] of pts) {
    assert.ok(y >= 50, `(${x}, ${y}) rises above the frame's middle`);
    assert.ok(x >= -10 && x <= 110, `(${x}, ${y}) runs sideways past the frame`);
  }
});

test('a medallion with its bust, a departed mala, a lamp kept and a hero at a window paint as one book', () => {
  const P = Object.fromEntries(PAPERCUT_PALETTE_KEYS.map((k) => [k, '#808080']));
  const defs = {};
  const art = artFor({ P, gradient: (id, def) => { defs[id] = def; return { ref: id }; } });
  const box = { x: 100, y: 100, w: 60, h: 60 };
  const person = { id: 'p1', gender: 'FEMALE', by: 1930, dy: 2001 };
  const items = [
    art.frame('medallion', box, [art.place(avatarFor(person, { year: 2026 }), { x: box.x, y: box.y, w: box.w, anchor: 'top-left' })]),
    art.place('mala-departed', { x: 130, y: 130, s: 0.6, departed: true }),
    art.place('lamp-unknown', { x: 250, y: 130, w: 22 }),
    art.frame('arch-jharokha', { x: 300, y: 300, w: 180, h: 230 }, [rect(250, 250, 300, 300, { fill: P.sky }),
      art.place(heroFor(person, { year: 2026 }), { x: 390, y: 530, w: 170 })]),
    art.place('toran', { x: 40, y: 40, w: 48 }), art.place('band-sanjhi', { x: 0, y: 0, w: 44, tint: 'peacock', shadow: 'soft' }),
    ...['kandil', 'diya-floating', 'lotus', 'peepal', 'mala', 'corner-paisley', 'divider-lotus', 'medallion-petals', 'medallion-carved', 'cameo']
      .map((id, i) => art.place(id, { x: 60 + i * 45, y: 700, w: 40 })),
  ];
  const book = { size: { ...PAGE }, fonts: {}, defs, symbols: art.symbols(), pages: [{ label: 'p', items }] };
  const full = { format: formatOf(book), ...book };
  assert.deepEqual(validateBook(full), []);
  assert.match(paintPage(full, 0, { photo: () => null, font: (k) => k }), /<svg/);
});
