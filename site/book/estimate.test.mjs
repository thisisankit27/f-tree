/*
 * estimateBytes' vector-art term (#245): measured, applied to format-2 books only, and high.
 *
 * The measurements come from tools/book_pdf_size.mjs (Chromium, not run in CI) and are recorded in
 * qa/pdf-size.json. These tests hold the constants to them: the term must allow every measured page
 * at least what its art really cost, so nobody can lower a constant below the evidence without a
 * new measurement.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeBook, estimateBytes, artStats, ART_PDF } from './compose.js';
import { BOOK_FIXTURES, TEMPLATES, NOW, loadFixture } from './qa/book-fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const MEASURED = JSON.parse(readFileSync(path.join(here, 'qa/pdf-size.json'), 'utf8'));
const CONFORMANCE = JSON.parse(readFileSync(path.join(here, 'golden/format2-conformance.json'), 'utf8'));
const PAGE_ALLOWANCE = 18_000;   // estimateBytes' per-page constant
const term = (r) => Object.keys(ART_PDF).reduce((sum, k) => sum + r[k] * ART_PDF[k], 0);

test('a format-1 book is estimated exactly as before the art term', async () => {
  // The formula as it stood before #245, written out: a change here is a change to what every
  // Heirloom and Diwali reader is told.
  const before = (book, lossless) => Math.round(420_000 + book.pages.length * 18_000
    + book.photos.reduce((sum, p) => sum + p.px * p.px * (lossless ? 1.8 : 0.22), 0));
  for (const name of Object.keys(BOOK_FIXTURES)) {
    const doc = await loadFixture(name);
    for (const [tid, tpl] of Object.entries(TEMPLATES)) {
      if (tpl.format !== 1) continue;
      const book = composeBook(doc, { now: NOW }, tpl);
      assert.equal(book.format, 1);
      for (const lossless of [true, false]) assert.equal(estimateBytes(book, { lossless }), before(book, lossless), `${name}/${tid}`);
    }
  }
});

test('a format-2 book is estimated with its art', () => {
  const base = 420_000 + CONFORMANCE.pages.length * 18_000 + CONFORMANCE.photos.reduce((sum, p) => sum + p.px * p.px * 0.22, 0);
  const stats = artStats(CONFORMANCE);
  assert.ok(stats.bytes > 0 && stats.gradients > 0 && stats.clips > 0 && stats.layers > 0, JSON.stringify(stats));
  const est = estimateBytes(CONFORMANCE, { lossless: false });
  assert.equal(est, Math.round(base + Math.ceil(term(stats))));
  assert.ok(est > base);
});

test('every use counts as the symbol it draws, so more lamps estimate bigger', () => {
  const page = CONFORMANCE.pages[1];
  const uses = page.items.filter((it) => it.t === 'use').length;
  assert.ok(uses > 0);
  const more = { ...CONFORMANCE, pages: [{ ...page, items: [...page.items, ...page.items.filter((it) => it.t === 'use')] }] };
  const once = { ...CONFORMANCE, pages: [page] };
  const [a, b] = [artStats(once), artStats(more)];
  const drawn = (s) => s.bytes;
  assert.ok(drawn(b) > drawn(a), 'doubling the uses must add their symbols\' bytes');
  // A symbol that nothing uses costs nothing: only what is drawn is counted.
  const unused = { ...once, symbols: { ...once.symbols, spare: { items: [{ t: 'rect', x: 0, y: 0, w: 1e3, h: 1e3, fill: '#000000' }] } } };
  assert.deepEqual(artStats(unused), a);
});

test('the art term covers every page that was measured', () => {
  assert.ok(MEASURED.rows.length >= 10, 'the recorded measurements are missing');
  for (const r of MEASURED.rows) {
    const allowed = term(r) + PAGE_ALLOWANCE;
    assert.ok(allowed >= r.art, `${r.name}: the estimate allows ${Math.round(allowed)} bytes for art that printed at ${r.art}`);
  }
  // And with a margin: a quarter again on every page (the constants give at least 1.37x today).
  for (const r of MEASURED.rows) {
    assert.ok(term(r) + PAGE_ALLOWANCE >= r.art * 1.25, `${r.name}: less than 1.25x of the measured art`);
  }
  // The storybook-density book: 28 pages at the style frames' own density.
  const s = MEASURED.storybook;
  assert.ok(term(s) + s.pages * PAGE_ALLOWANCE >= s.pdf, 'the whole storybook-density book');
});

test('meta: a constant lowered below the measurements fails the coverage test', () => {
  const low = { ...ART_PDF, bytes: ART_PDF.bytes / 3, translucent: 0, gradients: 0 };
  const lowTerm = (r) => Object.keys(low).reduce((sum, k) => sum + r[k] * low[k], 0);
  assert.ok(MEASURED.rows.some((r) => lowTerm(r) + PAGE_ALLOWANCE < r.art), 'the coverage check would not notice a lowered constant');
});
