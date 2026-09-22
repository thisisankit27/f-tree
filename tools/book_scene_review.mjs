/*
 * The scenes' review renders (#254): every compiled scene placed on a page through art/draw.js and
 * painted by svg.js in headless Chromium, the way the book will draw it. Not a test, not run in CI.
 *
 *   FTREE_PLAYWRIGHT=/path/to/playwright/index.mjs node tools/book_scenes.mjs --review <out-dir>
 *
 * Writes, per scene:
 *   <id>.png         the scene alone, at twice page size;
 *   <id>-150.png     the same at 150 px wide, the size a chat app shows a cover at, and
 *   <id>-copy-150.png that thumbnail with the sample copy and lamps set, as the page will be;
 *   <id>-zones.png   the scene with its zones outlined, the sample copy set in its text zones, and
 *                    stand-in lamps where the page would float them - what a page will look like;
 * then sheet.png, every scene side by side, to judge page-to-page variety, and it prints each
 * scene's bytes and its share of estimateBytes' art term (compose.js).
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { artFor, LIBRARY } from '../site/book/art/index.js';
import { artStats, artTerm } from '../site/book/compose.js';
import { PAGE, path as pathItem, text, validateBook } from '../site/book/format.js';
import { paintPage } from '../site/book/svg.js';
import { METRICS } from '../site/book/metrics/index.js';
import { seeded } from '../site/book/art/seed.js';
import { SAMPLE_COPY, setCopy } from '../site/book/qa/scene-copy.mjs';
import { loadPlaywright, fontFaces, settle } from './book_print.mjs';
import { SRC_DIR } from './book_art.mjs';

/** The palette the swatches paint with: the approved frames' colours, by token. */
const PALETTE = Object.fromEntries(Object.entries(JSON.parse(readFileSync(path.join(SRC_DIR, 'swatches.json'), 'utf8')).swatches).map(([hex, token]) => [token, hex]));

/** One page: the scene, and with `annotate` its zones, the sample copy and stand-in lamps. */
export function scenePage(id, { annotate = false, outline = true } = {}) {
  const defs = {};
  const art = artFor({ P: PALETTE, gradient: (gid, def) => { defs[gid] = def; return { ref: gid }; } });
  const at = { x: 0, y: 0, w: PAGE.w };
  const items = [art.place(id, at)];
  if (annotate) {
    const zones = art.zones(id, at);
    const lamps = zones.find((z) => z.name === 'lamps');
    if (lamps) {
      // 23 lamps drifting toward the viewer: what the cover's page will float here, one a person
      const rand = seeded('review-lamps');
      for (let i = 0; i < 23; i++) {
        const t = (i + 0.5) / 23;
        items.push(art.place('diya', { x: lamps.x + lamps.w * (0.2 + 0.6 * rand()), y: lamps.y + Math.pow(t, 1.5) * lamps.h, w: 6 + Math.pow(t, 1.6) * 40 }));
      }
    }
    for (const z of outline ? zones : []) {
      const colour = z.kind === 'text' ? '#1e90ff' : z.kind === 'face' ? '#22aa44' : '#e0303a';
      items.push(pathItem(`M${z.x} ${z.y}L${z.x + z.w} ${z.y}L${z.x + z.w} ${z.y + z.h}L${z.x} ${z.y + z.h}Z`, { stroke: colour, sw: 1, dash: [4, 3] }));
      items.push(text(z.x + 3, z.y + 9, `${z.kind}${z.name ? `: ${z.name}` : ''}`, 'book_text', 7, colour));
    }
    for (const t of setCopy(SAMPLE_COPY[id] ?? {}, zones, METRICS)) items.push(text(t.x, t.y, t.s, t.font, t.size, PALETTE[t.fill], { align: t.align }));
  }
  const book = { format: 2, size: { ...PAGE }, fonts: { book_display: 'book_display', book_text: 'book_text', book_strong: 'book_strong', book_hand: 'book_hand' }, defs, symbols: art.symbols(), pages: [{ label: id, items }] };
  const problems = validateBook(book);
  if (problems.length) throw new Error(`${id}: the review page does not validate: ${problems.slice(0, 3).join('; ')}`);
  return book;
}

/** What one scene costs: its compiled JSON, and its share of the PDF estimate's art term. */
export function sceneCost(id) {
  const own = Object.entries(LIBRARY.symbols).filter(([k]) => k === id || k.startsWith(`${id}--`)).map(([, s]) => s.items);
  const grads = Object.entries(LIBRARY.gradients).filter(([k]) => k.startsWith(`${id}-g`)).map(([, g]) => g);
  const json = Buffer.byteLength(JSON.stringify(own), 'utf8') + Buffer.byteLength(JSON.stringify(grads), 'utf8');
  const stats = artStats(scenePage(id));
  return { json, stats, pdf: Math.ceil(artTerm(stats)) };
}

const svgOf = (book, prefix) => paintPage(book, 0, { photo: () => null, font: (k) => k, idPrefix: prefix });

export async function review(out, ids) {
  mkdirSync(out, { recursive: true });
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  try {
    const shoot = async (svg, file, width, scale) => {
      const page = await browser.newPage({ viewport: { width, height: Math.ceil((width * PAGE.h) / PAGE.w) }, deviceScaleFactor: scale });
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${fontFaces()}html,body{margin:0}svg{display:block;width:${width}px;height:auto}</style></head><body>${svg}</body></html>`, { waitUntil: 'load' });
      await settle(page);
      await page.locator('svg').first().screenshot({ path: file });
      await page.close();
      console.log(`  ${file}`);
    };
    for (const id of ids) {
      const plain = svgOf(scenePage(id), `${id}-`);
      await shoot(plain, path.join(out, `${id}.png`), PAGE.w, 2);
      await shoot(plain, path.join(out, `${id}-150.png`), 150, 1);
      await shoot(svgOf(scenePage(id, { annotate: true }), `${id}-z-`), path.join(out, `${id}-zones.png`), PAGE.w, 2);
      await shoot(svgOf(scenePage(id, { annotate: true, outline: false }), `${id}-c-`), path.join(out, `${id}-copy-150.png`), 150, 1);
      const c = sceneCost(id);
      console.log(`  ${id}: ${c.json} B compiled, art term ${c.pdf} B (${JSON.stringify(c.stats)})`);
    }
    const cells = ids.map((id) => `<figure style="margin:0;width:220px"><div style="width:220px">${svgOf(scenePage(id, { annotate: true }), `s-${id}-`)}</div><figcaption style="font:12px sans-serif">${id}</figcaption></figure>`).join('');
    const page = await browser.newPage({ viewport: { width: 1400, height: 400 }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${fontFaces()}body{margin:10px;display:flex;gap:10px;flex-wrap:wrap;background:#ddd}svg{display:block;width:220px;height:auto}</style></head><body>${cells}</body></html>`, { waitUntil: 'load' });
    await settle(page);
    await page.screenshot({ path: path.join(out, 'sheet.png'), fullPage: true });
    await page.close();
    console.log(`  ${path.join(out, 'sheet.png')}`);
    writeFileSync(path.join(out, 'costs.json'), JSON.stringify(Object.fromEntries(ids.map((id) => [id, sceneCost(id)])), null, 1));
  } finally {
    await browser.close();
  }
}
