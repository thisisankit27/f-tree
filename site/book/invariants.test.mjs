/*
 * The layout invariants (#245), over every fixture x every template x three featured people.
 *
 * Fixtures and templates are read off the disk (qa/book-fixtures.mjs), so a new fixture, or the
 * storybook's hidden `diwali-story` template, is covered the day it lands. The rules themselves are
 * in qa/invariants.mjs; the meta-tests at the bottom prove each one fails on a book broken for the
 * purpose. The banned-API guard, the last item on the plan's list, is book.test.mjs's closure test.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeBook, composeWithReport } from './compose.js';
import { BOOK_FIXTURES, STORYBOOK_MANIFEST, TEMPLATES, NOW, loadFixture } from './qa/book-fixtures.mjs';
import {
  INVARIANTS, everyoneShown, sizes, noTextOverlap, noTextInBusyArt, consecutivePagesVary, peoplePerPage,
  pageCount, jsonBudget, pdfBudget, noLivingAge, pageBounds,
} from './qa/invariants.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const YEAR = Number(NOW.slice(0, 4));

/*
 * The three featured choices the plan asks for, from the document alone:
 *   - most connected: no `featured` at all, so resolveFeatured falls back to mostConnected;
 *   - the eldest: the named person with the earliest birth year (ties by id);
 *   - a leaf: a named person with no children - the youngest such, preferring one whose parents
 *     are known (ties by id).
 * A fixture whose manifest names its own F (the unlinked F, for one) adds that as a fourth.
 */
function featuredChoices(name, doc) {
  const people = (doc.people ?? []).filter((p) => p.name);
  const year = (p) => Number(/^(\d{4})/.exec(p.birthDate ?? '')?.[1] ?? NaN);
  const rels = doc.relationships ?? [];
  const hasChildren = new Set(rels.filter((r) => r.type === 'PARENT').map((r) => r.from));
  const hasParents = new Set(rels.filter((r) => r.type === 'PARENT').map((r) => r.to));
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const dated = people.filter((p) => Number.isFinite(year(p)));
  const eldest = [...dated].sort((a, b) => year(a) - year(b) || byId(a, b))[0] ?? people[0];
  const leaves = people.filter((p) => !hasChildren.has(p.id));
  const leaf = [...leaves].sort((a, b) => (hasParents.has(b.id) - hasParents.has(a.id)) || ((year(b) || 0) - (year(a) || 0)) || byId(a, b))[0];
  const choices = { 'most connected': undefined, eldest: eldest?.id, leaf: leaf?.id };
  const declared = STORYBOOK_MANIFEST[name]?.ids?.featured;
  if (declared && !Object.values(choices).includes(declared)) choices.declared = declared;
  return choices;
}

/** A template the composer can draw today. A format-2 one is refused until the story planner lands. */
function drawable(tpl) {
  try {
    composeBook({ format: 'f-tree', version: 1 }, { now: NOW }, tpl);
    return true;
  } catch (error) {
    if (/cannot draw yet/.test(error.message)) return false;
    throw error;
  }
}

const DRAWABLE = Object.entries(TEMPLATES).filter(([, t]) => drawable(t));
const STORY = Object.entries(TEMPLATES).filter(([, t]) => t.format === 2);
const STORY_DRAWABLE = DRAWABLE.filter(([, t]) => t.format === 2);

function check(ctx) {
  const failures = [];
  for (const [name, { check: fn, storyOnly }] of Object.entries(INVARIANTS)) {
    if (storyOnly && ctx.book.format < 2) continue;
    for (const v of fn(ctx)) failures.push(`${name}: ${v}`);
  }
  return failures;
}

for (const name of Object.keys(BOOK_FIXTURES)) {
  test(`invariants: ${name}`, async (t) => {
    const doc = await loadFixture(name);
    const scope = new Set((doc.people ?? []).map((p) => p.id));
    for (const [tid, tpl] of DRAWABLE) {
      const seen = new Map();
      for (const [choice, featured] of Object.entries(featuredChoices(name, doc))) {
        await t.test(`${tid}, featuring the ${choice}${featured ? ` (${featured})` : ''}`, () => {
          const options = { now: NOW, ...(featured ? { featured } : {}) };
          const { book, report } = composeWithReport(doc, options, tpl);
          const failures = check({ doc, options, book, report, scope, year: YEAR });
          assert.deepEqual(failures.slice(0, 15), [], `${failures.length} violations`);
          seen.set(choice, JSON.stringify(book));
        });
      }
      if (tpl.format === 1) {
        // Heirloom and the current Diwali don't feature anybody: the choice must not move a byte.
        assert.equal(new Set(seen.values()).size, 1, `${tid} changed with the featured person`);
      }
    }
  });
}

test('invariants: a family with a photograph for everyone stays under 10 MB', async () => {
  for (const name of ['large', 'story-large']) {
    const doc = await loadFixture(name);
    for (const p of doc.people) p.photo = `photos/${p.id}.jpg`;
    for (const [tid, tpl] of DRAWABLE) {
      const book = composeBook(doc, { now: NOW }, tpl);
      assert.deepEqual(pdfBudget({ book }), [], `${name}/${tid}`);
    }
  }
});

test('invariants: the featured choices are real, distinct people where the fixture allows', async () => {
  const leaf = featuredChoices('story-leaf', await loadFixture('story-leaf'));
  assert.equal(leaf.eldest, 'pgf');
  assert.equal(leaf.leaf, 'f');
  const unlinked = featuredChoices('story-unlinked', await loadFixture('story-unlinked'));
  assert.equal(unlinked.eldest, 'f', 'the unlinked F is the eldest, so the eldest choice features them');
  assert.deepEqual(featuredChoices('story-empty', await loadFixture('story-empty')), { 'most connected': undefined, eldest: undefined, leaf: undefined });
});

// ---------------------------------------------------------------------------------------------
// The storybook. It does not exist yet (#251, #256-#258); these make sure it is covered the day it
// does, and say so loudly if it arrives in a shape the suite cannot check.

const storyReason = STORY.length
  ? `${STORY.map(([id]) => id).join(', ')} exists, but the composer cannot draw format 2 yet (#251)`
  : 'there is no format-2 template yet: the storybook arrives as a hidden diwali-story template (#251, #256-#258)';

test('storybook: every invariant runs over it, the story-only ones included', { skip: STORY_DRAWABLE.length ? false : storyReason }, () => {
  // The loop above already includes every drawable format-2 template; this marks that it did.
  assert.ok(STORY_DRAWABLE.length > 0);
});

test('storybook: a story composer cannot land without the suite covering it', async () => {
  const composeSrc = readFileSync(path.join(here, 'compose.js'), 'utf8');
  const composerExists = !/cannot draw yet/.test(composeSrc);
  if (composerExists) {
    assert.ok(STORY.length > 0, 'compose.js draws format 2 now, but no format-2 template exists for the invariant suite to run it over - add templates/diwali-story.json');
  }
  for (const [id] of STORY) {
    assert.ok(!composerExists || STORY_DRAWABLE.some(([d]) => d === id), `${id} is a format-2 template the composer still refuses, although it draws format 2`);
  }
  const catalog = JSON.parse(readFileSync(path.join(here, 'templates/catalog.json'), 'utf8'));
  for (const entry of catalog.templates.filter((e) => e.format >= 2)) {
    assert.ok(STORY_DRAWABLE.some(([d]) => d === entry.id), `the catalogue offers ${entry.id} at format ${entry.format}, which the invariant suite cannot draw`);
  }
  // What the story-only invariants read has to be there, or they would pass by reading nothing.
  for (const [id, tpl] of STORY_DRAWABLE) {
    const { book, report } = composeWithReport(await loadFixture('story-large'), { now: NOW }, tpl);
    assert.equal(book.format, 2, `${id} made a format-${book.format} book`);
    assert.ok(report.artZones.some((z) => z.kind === 'busy' || z.kind === 'face'), `${id}: its art records no busy or face zones (ctx.zone), so text-over-art is checked against nothing`);
    assert.ok(report.pages.every((p) => p.archetype), `${id}: a page does not describe itself (ctx.describePage)`);
    assert.ok(report.textBoxes.every((b) => b.kind), `${id}: a line does not say what kind it is (ctx.line(..., { kind }))`);
  }
});

// ---------------------------------------------------------------------------------------------
// Meta: each invariant, on a book broken for the purpose. A check that never fails checks nothing.

const base = async () => {
  const doc = await loadFixture('story-leaf');
  const { book, report } = composeWithReport(doc, { now: NOW }, TEMPLATES.heirloom);
  return { doc, book, report, scope: new Set(doc.people.map((p) => p.id)), year: YEAR };
};
const clone = (x) => structuredClone(x);
const box = (page, s, x, y, extra = {}) => ({ page, x, y, w: 80, h: 10, size: 11, font: 'text', kind: null, op: 1, s, ...extra });

test('meta: everyone shown fails when someone is on no page', async () => {
  const c = await base();
  assert.deepEqual(everyoneShown(c), []);
  const report = clone(c.report);
  delete report.shown.f;
  assert.deepEqual(everyoneShown({ ...c, report }), ['f is in scope but on no page']);
});

test('meta: sizes fail under the floor, by kind, and on an unclassified storybook line', async () => {
  const c = await base();
  assert.deepEqual(sizes(c), []);
  const small = { ...c, report: { ...c.report, textBoxes: [box(1, 'tiny', 0, 0, { size: 5.9 })] } };
  assert.equal(sizes(small).length, 1);
  const story = { book: { format: 2 }, report: { textBoxes: [
    box(1, 'a sentence', 0, 0, { size: 10, kind: 'body' }),
    box(1, 'Asha', 0, 20, { size: 8.5, kind: 'name' }),
    box(1, 'grandmother', 0, 40, { size: 7.5, kind: 'caption' }),
    box(1, 'folio', 0, 60, { size: 6.9, kind: 'folio' }),
    box(1, 'unsaid', 0, 80, { size: 12 }),
  ] } };
  const v = sizes(story);
  assert.ok(v.some((x) => /body "a sentence" at 10 pt, under 10.5/.test(x)), v.join('\n'));
  assert.ok(v.some((x) => /name "Asha"/.test(x)));
  assert.ok(v.some((x) => /caption "grandmother"/.test(x)));
  assert.ok(v.some((x) => /"folio" at 6.9 pt, under 7/.test(x)));
  assert.ok(v.some((x) => /"unsaid" has no kind/.test(x)));
});

test('meta: text over text fails, and a faint watermark does not', async () => {
  const c = await base();
  assert.deepEqual(noTextOverlap(c), []);
  const report = { textBoxes: [box(2, 'one', 10, 10), box(2, 'two', 50, 15), box(2, 'VII', 0, 0, { op: 0.2, w: 200, h: 100 }), box(3, 'other page', 10, 10)] };
  assert.deepEqual(noTextOverlap({ report }), ['page 2: "one" and "two" overlap']);
});

test('meta: text in a busy zone fails, in a text zone does not', () => {
  const report = {
    textBoxes: [box(4, 'in the banyan', 100, 100), box(4, 'in the sky', 300, 50)],
    artZones: [{ page: 4, kind: 'busy', x: 90, y: 90, w: 50, h: 50 }, { page: 4, kind: 'text', x: 290, y: 40, w: 120, h: 40 }],
  };
  assert.deepEqual(noTextInBusyArt({ report }), ['page 4: "in the banyan" sits in a busy zone']);
});

test('meta: consecutive pages that repeat composition and placement fail', () => {
  const page = (n, archetype, variant) => ({ page: n, label: `p${n}`, archetype, variant, people: [], density: null });
  assert.deepEqual(consecutivePagesVary({ report: { pages: [page(1, 'hero', 'arch'), page(2, 'hero', 'window'), page(3, 'lane', 'a')] } }), []);
  assert.deepEqual(consecutivePagesVary({ report: { pages: [page(1, 'hero', 'arch'), page(2, 'hero', 'arch')] } }), ['pages 1 and 2 are both hero/arch']);
  assert.equal(consecutivePagesVary({ report: { pages: [page(1, null, null)] } }).length, 1, 'an undescribed page is a violation, not a pass');
});

test('meta: a page over its density cap fails', () => {
  const page = (density, n) => ({ page: 1, label: 'x', archetype: 'a', variant: 'v', density, people: Array.from({ length: n }, (_, i) => `p${i}`) });
  assert.deepEqual(peoplePerPage({ report: { pages: [page('family', 8), page('hero', 2), page('register', 48)] } }), []);
  assert.equal(peoplePerPage({ report: { pages: [page('family', 9)] } }).length, 1);
  assert.equal(peoplePerPage({ report: { pages: [page('hero', 3)] } }).length, 1);
  assert.equal(peoplePerPage({ report: { pages: [page('gathering', 13)] } }).length, 1);
  assert.equal(peoplePerPage({ report: { pages: [page(null, 3)] } }).length, 1, 'people on a page with no density row');
});

test('meta: a book that runs away, or comes up empty, fails the page count', async () => {
  const c = await base();
  assert.deepEqual(pageCount(c), []);
  const long = { ...c.book, pages: Array.from({ length: 60 }, () => c.book.pages[0]) };
  assert.equal(pageCount({ ...c, book: long }).length, 1);
  assert.equal(pageCount({ ...c, book: { ...c.book, pages: c.book.pages.slice(0, 2) } }).length, 1);
  assert.deepEqual(pageBounds(2, 0), [3, 4]);
  assert.deepEqual(pageBounds(2, 3), [3, 7]);
  assert.ok(pageBounds(2, 200)[1] >= 28 + 5, 'about 200 people may take 22-28 story pages plus the register');
});

test('meta: JSON over budget fails, for the page and for the book', async () => {
  const c = await base();
  assert.deepEqual(jsonBudget(c), []);
  const pad = 'x'.repeat(160_000);
  const fat = { ...c.book, pages: [{ label: 'fat', items: [{ t: 'text', s: pad }] }] };
  assert.equal(jsonBudget({ book: fat }).length, 1);
  const huge = { ...c.book, pages: Array.from({ length: 12 }, () => ({ label: 'p', items: [{ t: 'text', s: 'y'.repeat(140_000) }] })) };
  assert.deepEqual(jsonBudget({ book: huge }).map((v) => v.startsWith('the book is')), [true]);
});

test('meta: a PDF estimated at 10 MB or more fails', async () => {
  const c = await base();
  assert.deepEqual(pdfBudget(c), []);
  const photos = Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, px: 200 }));
  assert.equal(pdfBudget({ book: { ...c.book, photos } }).length, 1, '200 lossless 200 px portraits is 14.4 MB');
});

test('meta: a living person\'s age fails, a departed person\'s life does not', async () => {
  const doc = JSON.parse(readFileSync(path.join(here, 'fixtures/remarriage.json'), 'utf8'));
  const { book, report } = composeWithReport(doc, { now: NOW }, TEMPLATES.heirloom);
  const c = { doc, book, report, year: YEAR };
  assert.deepEqual(noLivingAge(c), [], 'Harish\'s "61 years" is a departed life');
  for (const s of ['Rekha, 68 years', 'Rekha is aged 68', 'रेखा 67 साल की']) {
    const r = { ...report, textBoxes: [...report.textBoxes, box(1, s, 0, 0)] };
    assert.equal(noLivingAge({ ...c, report: r }).length, 1, s);
  }
});
