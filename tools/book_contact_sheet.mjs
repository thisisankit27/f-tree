/*
 * The family book's contact sheet (#245): every fixture's pages, in every template the composer
 * can draw, painted by svg.js in headless Chromium, for the by-eye review the storybook's
 * verification bar asks for. Not run in CI.
 *
 *   FTREE_PLAYWRIGHT=/path/to/playwright/index.mjs node tools/book_contact_sheet.mjs <out-dir> [fixture ...]
 *
 * For each fixture it writes:
 *   - <out-dir>/<fixture>.png: one grid, a row per template, every page labelled with its number
 *     and title;
 *   - <out-dir>/<fixture>-<template>-cover-150.png: the cover at 150 px wide, the size a chat app
 *     shows it at. The cover must still read there (docs/book-design-system.md).
 * and <out-dir>/index.html, every sheet on one page.
 *
 * Fixtures and templates are the invariant suite's own (site/book/qa/book-fixtures.mjs), so the
 * storybook's hidden `diwali-story` template joins the sheet the day it composes. Photographs come
 * from the sample archive where it has them; the synthetic fixtures have none, and their portraits
 * show the ring the painter keeps for a photograph it cannot load. Playwright: see tools/book_print.mjs.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { composeBook, drawable } from '../site/book/compose.js';
import { paintPage, esc } from '../site/book/svg.js';
import { BOOK_FIXTURES, TEMPLATES, NOW, loadFixture, openFixtureArchive } from '../site/book/qa/book-fixtures.mjs';
import { loadPlaywright, fontFaces, settle } from './book_print.mjs';

const THUMB = 180;      // px wide, a page on the sheet
const COVER = 150;      // px wide, the chat thumbnail

const out = process.argv[2];
if (!out) {
  console.error('usage: node tools/book_contact_sheet.mjs <out-dir> [fixture ...]');
  process.exit(2);
}
mkdirSync(out, { recursive: true });
const wanted = process.argv.slice(3);
const fixtures = Object.keys(BOOK_FIXTURES).filter((f) => !wanted.length || wanted.includes(f));
const unknown = wanted.filter((f) => !BOOK_FIXTURES[f]);
if (unknown.length) {
  console.error(`no such fixture: ${unknown.join(', ')}. Known: ${Object.keys(BOOK_FIXTURES).join(', ')}`);
  process.exit(2);
}

/** The sample archive's photographs as data: URLs, by person id. Everyone else has none. */
async function photosOf(name, doc) {
  const archive = await openFixtureArchive(name);
  if (!archive) return () => null;
  const urls = new Map();
  for (const p of doc.people ?? []) {
    if (!p.photo) continue;
    try {
      const bytes = await archive.read(p.photo);
      urls.set(p.id, `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`);
    } catch { /* a photograph the archive lost: the ring still stands */ }
  }
  return (id) => urls.get(id) ?? null;
}

/** A fixture's rows: one book per template, or a note that the composer cannot draw it yet. */
const books = (doc) => Object.entries(TEMPLATES).map(([tid, tpl]) => (drawable(tpl)
  ? { label: tid, tid, book: composeBook(doc, { now: NOW }, tpl) }
  : { label: `${tid}: format ${tpl.format}, which the composer cannot draw yet`, tid, book: null }));

function sheetHtml(name, rows, photo) {
  const row = ({ label, book }, r) => {
    if (!book) return `<section><h2>${esc(label)}</h2></section>`;
    const pages = book.pages.map((p, i) => `<figure><div class="pg">${paintPage(book, i, { photo, font: (k) => k, idPrefix: `r${r}p${i}-` })}</div>`
      + `<figcaption>${i + 1}. ${esc(p.label)}</figcaption></figure>`).join('');
    return `<section><h2>${esc(label)} <small>${book.pages.length} pages, format ${book.format}</small></h2><div class="row">${pages}</div></section>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces()}
body { margin: 16px; font: 13px/1.4 system-ui, sans-serif; background: #f4f1ea; color: #222; }
h1 { font-size: 18px; margin: 0 0 12px; }
h2 { font-size: 14px; margin: 16px 0 6px; } h2 small { font-weight: normal; color: #666; }
.row { display: flex; flex-wrap: wrap; gap: 10px; }
figure { margin: 0; width: ${THUMB}px; }
.pg { width: ${THUMB}px; height: ${Math.round((THUMB * 842) / 595)}px; box-shadow: 0 1px 3px #0004; background: #fff; }
.pg svg { width: 100%; height: 100%; display: block; }
figcaption { font-size: 11px; color: #444; margin-top: 3px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
</style></head><body><h1>${esc(name)}</h1>${rows.map(row).join('')}</body></html>`;
}

const coverHtml = (book, photo) => `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces()}
html, body { margin: 0; } #c { width: ${COVER}px; height: ${Math.round((COVER * 842) / 595)}px; } #c svg { width: 100%; height: 100%; display: block; }
</style></head><body><div id="c">${paintPage(book, 0, { photo, font: (k) => k })}</div></body></html>`;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch();
const sheets = [];   // { name, sheet, covers: [] }
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 1 });
  for (const name of fixtures) {
    const doc = await loadFixture(name);
    const photo = await photosOf(name, doc);
    const rows = books(doc);
    await page.setContent(sheetHtml(name, rows, photo), { waitUntil: 'load' });
    await settle(page);
    const sheet = path.join(out, `${name}.png`);
    await page.screenshot({ path: sheet, fullPage: true });
    const entry = { name, sheet, covers: [] };
    sheets.push(entry);
    for (const { tid, book } of rows) {
      if (!book) continue;
      await page.setContent(coverHtml(book, photo), { waitUntil: 'load' });
      await settle(page);
      const cover = path.join(out, `${name}-${tid}-cover-150.png`);
      await page.locator('#c').screenshot({ path: cover });
      entry.covers.push(cover);
    }
    console.log(`${name}: ${rows.filter((r) => r.book).map((r) => `${r.tid} ${r.book.pages.length}p`).join(', ')}`);
  }
} finally {
  await browser.close();
}
const img = (f, alt) => `<img src="${esc(path.basename(f))}" alt="${esc(alt)}" title="${esc(path.basename(f, '.png'))}">`;
const index = `<!doctype html><html><head><meta charset="utf-8"><title>Book contact sheet</title>
<style>body{font:14px system-ui,sans-serif;margin:16px;background:#f4f1ea}img{max-width:100%;display:block;margin:8px 0 12px;box-shadow:0 1px 3px #0003}.covers img{display:inline-block;margin:4px 8px 24px 0}</style></head><body>
<h1>Book contact sheet, ${NOW}</h1>
${sheets.map((e) => `<h2>${esc(e.name)}</h2>${img(e.sheet, `Every page of the ${e.name} fixture`)}<div class="covers">${e.covers.map((c) => img(c, `${path.basename(c, '.png')}, at 150 px`)).join('')}</div>`).join('\n')}
</body></html>`;
writeFileSync(path.join(out, 'index.html'), index);
console.log(`\n${sheets.length} sheets, ${sheets.reduce((n, e) => n + e.covers.length, 0)} covers: ${path.join(out, 'index.html')}`);
