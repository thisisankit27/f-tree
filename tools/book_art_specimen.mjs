/*
 * The paper-cut art's specimen sheets (#253): every avatar, frame, lamp, flower and ornament placed
 * the way pages will place them - busts in medallions, heroes at a window, the departed's mala, a
 * register row at 22 pt - painted by svg.js in headless Chromium, beside the approved style frame
 * they must match. The by-eye check the design system asks for; not run in CI.
 *
 *   FTREE_PLAYWRIGHT=/path/to/playwright/index.mjs node tools/book_art_specimen.mjs <out-dir>
 *
 * Writes <out-dir>/specimen-people.png, specimen-motifs.png (A4 at 2x) and specimen-thumb.png
 * (the people sheet at 150 px wide, a chat thumbnail). Re-run after `node tools/book_art.mjs`.
 */

import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { artFor } from '../site/book/art/index.js';
import { rect, text, PAGE, validateBook, formatOf } from '../site/book/format.js';
import { paintPage } from '../site/book/svg.js';
import { PAPERCUT_PALETTE_KEYS } from '../site/book/template.js';
import { GENDERS, STAGES, VARIANTS } from '../site/book/story/avatars.js';
import { loadPlaywright, fontFaces, settle } from './book_print.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2];
if (!out) { console.error('usage: node tools/book_art_specimen.mjs <out-dir>'); process.exit(2); }
mkdirSync(out, { recursive: true });

const swatches = JSON.parse(readFileSync(path.join(repo, 'site/book/art/src/papercut/swatches.json'), 'utf8')).swatches;
const P = Object.fromEntries(Object.entries(swatches).map(([hex, token]) => [token, hex.toLowerCase()]));
for (const k of PAPERCUT_PALETTE_KEYS) if (!P[k]) throw new Error(`no swatch for ${k}`);

/** One A4 page drawn through draw.js, as a composer page would be. */
function sheet(draw) {
  const defs = {};
  const art = artFor({ P, gradient: (id, def) => { defs[id] = def; return { ref: id }; } });
  const items = [];
  const label = (x, y, s, o = {}) => items.push(text(x, y, s, 'text', o.size ?? 6.5, o.fill ?? P.inkSoft, { align: 'middle' }));
  draw({ art, items, label });
  const book = { size: { ...PAGE }, fonts: { text: 'book_text' }, defs, symbols: art.symbols(), pages: [{ label: 'specimen', items }] };
  const full = { format: formatOf(book), ...book };
  const problems = validateBook(full);
  if (problems.length) throw new Error(`the specimen does not validate: ${problems.slice(0, 5).join('; ')}`);
  return paintPage(full, 0, { photo: () => null, font: (k) => k });
}

const medallion = (art, items, frame, id, cx, cy, d) => {
  const box = { x: cx - d / 2, y: cy - d / 2, w: d, h: d };
  items.push(art.frame(frame, box, [art.place(id, { x: box.x, y: box.y, w: d, anchor: 'top-left' })],
    { shadow: { dx: d * 0.02, dy: d * 0.028, op: 0.22 } }));
};

const people = sheet(({ art, items, label }) => {
  items.push(rect(0, 0, PAGE.w, PAGE.h, { fill: P.paper }));
  // every front bust, at story-medallion size, in rows by gender
  GENDERS.forEach((g, gi) => {
    STAGES.forEach((st, si) => VARIANTS.forEach((v, vi) => {
      const cx = 44 + (si * 2 + vi) * 70, cy = 50 + gi * 88;
      medallion(art, items, 'medallion', `avatar-${g}-${st}-${v}`, cx, cy, 56);
      label(cx, cy + 40, `${g} ${st} ${v}`);
    }));
  });
  // the departed: the mala on the frame; a photograph's carved ring; the group medallion; a lamp kept
  const row = 330;
  medallion(art, items, 'medallion', 'avatar-female-elder-a', 60, row, 64);
  items.push(art.place('mala-departed', { x: 60, y: row, s: 0.64, departed: true }));
  label(60, row + 56, 'departed: mala on the frame');
  medallion(art, items, 'medallion-carved', 'avatar-male-elder-a', 170, row, 60);
  label(170, row + 56, 'photograph mount (bust as stand-in)');
  medallion(art, items, 'medallion-petals', 'avatar-person-adult-a', 280, row, 60);
  label(280, row + 56, 'group medallion (petal ring)');
  items.push(art.place('lamp-unknown', { x: 380, y: row, w: 64 }));
  label(380, row + 56, 'name not known');
  items.push(art.place('aala', { x: 500, y: row + 44, h: 92, shadow: false }));
  label(500, row + 56, 'aala: name not known, scene size');
  // the register at 22 pt
  ['avatar-male-adult-a', 'avatar-female-youth-b', 'avatar-male-child-b', 'avatar-female-elder-b', 'avatar-person-youth-a'].forEach((id, i) => {
    medallion(art, items, 'cameo', id, 60 + i * 30, 420, 22);
  });
  items.push(art.place('lamp-unknown', { x: 210, y: 420, w: 22 }));
  label(135, 444, 'register cameos at 22 pt');
  // the heroes, from behind, at an arch window
  const heroes = ['hero-female-adult', 'hero-male-adult', 'hero-person-adult', 'hero-female-elder', 'hero-male-elder', 'hero-person-elder', 'hero-female-child', 'hero-male-child', 'hero-person-child'];
  heroes.forEach((id, i) => {
    const w = 96, h = 120, x = 28 + (i % 5) * 112, y = 470 + Math.floor(i / 5) * 185;
    items.push(art.frame('arch-jharokha', { x, y, w, h }, [
      rect(x - 20, y - 20, w + 40, h + 40, { fill: P.sky }),
      art.place(id, { x: x + w / 2, y: y + h, w: w * 0.9, shadow: { dx: 1, dy: 1.4, op: 0.22, soft: true } }),
    ]));
    label(x + w / 2, y + h + 44, id);
  });
});

const motifs = sheet(({ art, items, label }) => {
  items.push(rect(0, 0, PAGE.w, 421, { fill: P.paper }), rect(0, 421, PAGE.w, 421, { fill: P.night }));
  // the band and a toran across the head, as pages lay them
  for (let x = 0; x < PAGE.w; x += 44) items.push(art.place('band-sanjhi', { x, y: 0, w: 44, tint: 'peacock', shadow: { dx: 0.8, dy: 1.4, op: 0.3, soft: true } }));
  for (let x = 20; x < PAGE.w - 60; x += 48) items.push(art.place('toran', { x, y: 60, w: 48 }));
  items.push(art.place('corner-paisley', { x: 10, y: 360, w: 50, flip: 'y', anchor: 'bottom-left' }));
  const day = [['diya', 30], ['diya-small', 30], ['diya-unknown', 30], ['marigold', 26], ['marigold-bead', 16], ['mango-leaf', 12], ['peepal', 34], ['lotus', 60]];
  day.forEach(([id, w], i) => { const x = 50 + i * 68; items.push(art.place(id, { x, y: 170, w, anchor: 'center', shadow: id.startsWith('diya') || id.startsWith('marigold') ? false : true })); label(x, 210, id); });
  items.push(art.place('mala', { x: 160, y: 240, w: 200 }), art.place('divider-lotus', { x: 420, y: 260, w: 150 }));
  label(160, 300, 'mala'); label(420, 290, 'divider-lotus');
  items.push(art.place('medallion', { x: 130, y: 360, w: 50 }), art.place('medallion-petals', { x: 210, y: 360, w: 56 }), art.place('medallion-carved', { x: 290, y: 360, w: 60 }), art.place('cameo', { x: 360, y: 360, w: 22 }));
  label(245, 405, 'the frames, empty');
  // night: lanterns, lamps on water, the aala in a dark wall
  items.push(art.place('kandil', { x: 90, y: 421, w: 70 }), art.place('kandil', { x: 500, y: 421, w: 60 }));
  [[200, 620], [280, 640], [360, 615], [440, 650]].forEach(([x, y]) => items.push(art.place('diya-floating', { x, y, w: 52 })));
  label(320, 690, 'diya-floating', { fill: P.flame });
  items.push(rect(0, 700, PAGE.w, 142, { fill: P.glow }));
  items.push(art.place('aala', { x: 150, y: 820, h: 110 }), art.place('aala', { x: 440, y: 820, h: 110 }));
  label(295, 790, 'aala in a night wall; kandil above', { fill: P.flame });
});

const ref = `data:image/webp;base64,${readFileSync(path.join(repo, 'site/book/art/style-frames/approved/system.webp')).toString('base64')}`;
const html = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>${fontFaces()}
html,body{margin:0;background:#fff} .row{display:flex;gap:12px;align-items:flex-start} .pg{width:595px;height:842px} .pg svg{width:100%;height:100%;display:block}
.ref{width:595px;height:842px;background:url(${ref}) no-repeat;background-size:595px 842px}
.cap{font:12px system-ui;margin:4px}</style></head><body>${body}</body></html>`;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1220, height: 880 }, deviceScaleFactor: 2 });
  const shots = [
    ['specimen-people.png', `<div class="row"><div><div class="pg">${people}</div><div class="cap">#253, compiled through draw.js and svg.js</div></div><div><div class="ref"></div><div class="cap">approved: style-frames/approved/system.webp</div></div></div>`],
    ['specimen-motifs.png', `<div class="pg">${motifs}</div>`],
  ];
  for (const [name, body] of shots) {
    await page.setContent(html(body), { waitUntil: 'load' });
    await settle(page);
    await page.locator('body > div').first().screenshot({ path: path.join(out, name) });
    console.log(path.join(out, name));
  }
  const thumb = await browser.newPage({ viewport: { width: 150, height: 213 }, deviceScaleFactor: 1 });
  await thumb.setContent(html(`<div style="width:150px;height:213px"><div class="pg" style="width:150px;height:213px">${people}</div></div>`), { waitUntil: 'load' });
  await settle(thumb);
  await thumb.screenshot({ path: path.join(out, 'specimen-thumb.png') });
  console.log(path.join(out, 'specimen-thumb.png'));
} finally {
  await browser.close();
}
