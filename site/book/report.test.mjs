/*
 * composeWithReport (#245): the book composeBook makes, plus the report the QA harness reads.
 *
 * The report is gathered beside the book, so the first promise is that asking for it changes
 * nothing: the same bytes, fixture by fixture and template by template. The rest checks the
 * report says what the book actually holds.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { composeBook, composeWithReport, reportFromBook } from './compose.js';
import { BOOK_FIXTURES, TEMPLATES, NOW, loadFixture } from './qa/book-fixtures.mjs';

test('asking for a report never changes the book', async () => {
  for (const name of Object.keys(BOOK_FIXTURES)) {
    const doc = await loadFixture(name);
    for (const [tid, tpl] of Object.entries(TEMPLATES)) {
      if (tpl.format !== 1) continue;
      const plain = JSON.stringify(composeBook(doc, { now: NOW }, tpl));
      const { book } = composeWithReport(doc, { now: NOW }, tpl);
      assert.equal(JSON.stringify(book), plain, `${name}/${tid}`);
    }
  }
});

test('the report records every portrait, on the page it is drawn', async () => {
  const doc = await loadFixture('story-leaf');
  const { book, report } = composeWithReport(doc, { now: NOW }, TEMPLATES.heirloom);
  for (const p of doc.people) {
    const pages = report.shown[p.id];
    assert.ok(pages?.length, `${p.name} is not reported shown`);
    for (const n of pages) {
      const portraitHere = JSON.stringify(book.pages[n - 1]).includes(p.name);
      assert.ok(portraitHere, `${p.name} is reported on page ${n}, which does not name them`);
    }
  }
  assert.deepEqual(Object.keys(report.shown), [...Object.keys(report.shown)].sort(), 'shown is in id order');
});

test('text boxes are where the text prints, at the size it prints', async () => {
  const doc = await loadFixture('story-tiny');
  const { book, report } = composeWithReport(doc, { now: NOW }, TEMPLATES.heirloom);
  const texts = book.pages.flatMap((p) => JSON.stringify(p.items).match(/"t":"text"/g) ?? []).length;
  assert.equal(report.textBoxes.length, texts, 'one box per text item');
  const closing = report.textBoxes.find((b) => b.s === 'Is someone missing?');
  assert.ok(closing, 'the closing heading is reported');
  assert.equal(closing.page, book.pages.length);
  // Centred at 297.5 on its baseline at 196, 42 pt display: the box straddles the middle and sits
  // on the baseline.
  assert.ok(Math.abs(closing.x + closing.w / 2 - 297.5) < 0.01, `centred: ${closing.x} + ${closing.w} / 2`);
  assert.ok(closing.y < 196 && closing.y + closing.h > 196);
  assert.equal(closing.size, 42);
  assert.equal(report.minSize, Math.min(...report.textBoxes.map((b) => b.size)));
  // Format-1 blocks name only the lines the checks must treat differently: the generation
  // numeral's watermark and the numbers page's recorded life.
  assert.ok(report.textBoxes.every((b) => b.kind === null || b.kind === 'ornament' || b.kind === 'lifespan'), 'an unexpected kind');
  assert.ok(report.textBoxes.some((b) => b.kind === 'ornament'), 'the generation numeral is marked ornament');
  assert.deepEqual(report.artZones, [], 'format-1 art records no zones');
  assert.equal(report.pages.length, book.pages.length);
  assert.ok(report.pages.every((p, i) => p.page === i + 1 && p.archetype === null && p.label === book.pages[i].label));
});

test('a text box inside a transformed group is reported in page coordinates', async () => {
  // Nothing in a format-1 book puts text in a scaled group, so build one and check the walk.
  const doc = await loadFixture('story-tiny');
  const { book } = composeWithReport(doc, { now: NOW }, TEMPLATES.heirloom);
  const line = { t: 'text', x: 10, y: 20, s: 'Tiny', font: 'text', size: 10, fill: '#000000', w: 100 };
  const scaled = { ...book, pages: [{ label: 'x', items: [{ t: 'group', tf: [2, 0, 0, 2, 100, 50], items: [line] }] }] };
  const report = reportFromBook(scaled);
  const [box] = report.textBoxes;
  assert.equal(box.size, 20, 'a 10 pt line in a 2x group prints at 20 pt');
  assert.ok(Math.abs(box.x - 120) < 1e-9, `x ${box.x}`);
  assert.ok(Math.abs(box.y - (50 + 2 * (20 - 7.5))) < 1e-9, `y ${box.y}`);
  assert.equal(report.minSize, 20);
});

test('a line centred in a wide column is boxed at its own width, not the column\'s', async () => {
  // The tree page gives every name the whole pitch between people as its `w`; the name itself is
  // much narrower. Boxing it at `w` would report neighbouring spouses' names as overlapping.
  const doc = await loadFixture('story-tiny');
  const { book, report } = composeWithReport(doc, { now: NOW }, TEMPLATES.heirloom);
  const tree = book.pages.findIndex((p) => p.label === 'The whole family') + 1;
  const item = book.pages[tree - 1].items.find((it) => it.t === 'text' && it.s === 'Pema Lhamo');
  const box = report.textBoxes.find((b) => b.page === tree && b.s === 'Pema Lhamo');
  assert.ok(item && box);
  assert.ok(box.w < item.w - 10, `boxed at ${box.w}, column ${item.w}`);
});
