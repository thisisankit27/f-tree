/*
 * The hero page archetypes (#256): the cover, the opening, the waiting page, a portrait hero and
 * the closing.
 *
 * They are composed through `composeWithPages` with `qa/stub-pages.mjs` standing in for the
 * archetypes #257 and #258 own, so these run - and fail honestly - before those land, and keep
 * running unchanged once they have (`withStubs` prefers a real archetype over its stub).
 *
 * What is checked here is what the issue asks for and what no other suite can see: one lamp per
 * person on the cover and no more, the cover legible at a chat app's 150 px, the opening's
 * sentence inside the page whatever the names are, the mala only on somebody the record says has
 * died, no invented face on a person with no photograph, and both variants of every archetype.
 * The shared layout rules (sizes, collisions, density, the 10 MB budget) are `qa/invariants.mjs`'s
 * own, run here over the pages these five drew.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { composeBook, composeWithPages } from '../compose.js';
import { validateBook, PAGE } from '../format.js';
import { LIBRARY } from '../art/index.js';
import { readFamily, byKey } from '../family.js';
import { validateTemplate } from '../template.js';
import { withStubs } from '../qa/stub-pages.mjs';
import { STORY_TEMPLATE } from '../qa/story-template.mjs';
import { BOOK_FIXTURES, NOW, TEMPLATES, loadFixture } from '../qa/book-fixtures.mjs';
import { INVARIANTS } from '../qa/invariants.mjs';
import { kinOf } from './kin.js';
import { planStory, VARIANTS } from './plan.js';
import { resolveFeatured } from './featured.js';
import { openingLine } from './copy.js';
import { PAGES, lampRows, MIN_LAMP, rowsToWarm } from './pages/hero.js';
import { SAFE, bandTint, paperGround, tailpiece } from './pages/parts/page.js';
import { MALA_DROP, joinFrames, yearsCaption } from './pages/parts/people.js';
import { heroTint } from './avatars.js';
import { countWords } from '../blocks/words.js';
import { PAPERCUT_PALETTE } from '../qa/story-template.mjs';

const FIXTURES = Object.keys(BOOK_FIXTURES);
const MINE = Object.keys(PAGES);
const YEAR = Number(NOW.slice(0, 4));
/**
 * Every lamp drawing a page may light a person with. Round 2 (finding 4) adds `diya-floating`, the
 * leaf-boat variant the cover's near rows now use instead of a lamp planted on nothing.
 */
const LAMPS = ['pc-diya', 'pc-diya-small', 'pc-diya-unknown', 'pc-lamp-unknown', 'pc-diya-floating'];

const compose = async (name, options = {}, pages = withStubs()) => {
  const doc = await loadFixture(name);
  const family = readFamily(doc, { now: NOW, ...options });
  const { book, report } = composeWithPages(doc, { now: NOW, ...options }, STORY_TEMPLATE, pages);
  const kin = kinOf(family, resolveFeatured(family, options));
  const plan = planStory(kin, validateTemplate(STORY_TEMPLATE), family);
  return { doc, family, kin, plan, book, report };
};

/** Which pages of a composed book these five archetypes drew. */
const heroPages = (report) => report.pages.filter((p) => MINE.includes(p.archetype));
const pageOf = (report, archetype) => report.pages.find((p) => p.archetype === archetype);

/** Every item on a page, with every group walked - for round 2's tests, which check raw shapes
 * (a circle, a stroked rect) that a `use` doesn't reach. */
function flatItems(items, out = []) {
  for (const it of items ?? []) {
    out.push(it);
    if (it.t === 'group') flatItems(it.items, out);
  }
  return out;
}

/** Every `use` on a page, with every group walked: what the page actually placed. */
function uses(items, out = []) {
  for (const it of items ?? []) {
    if (it.t === 'use') out.push(it.ref);
    if (it.t === 'group') uses(it.items, out);
  }
  return out;
}

const texts = (report, page) => report.textBoxes.filter((b) => b.page === page);
const said = (report, page) => texts(report, page).map((b) => b.s).join(' | ');

/**
 * The three featured people the plan's verification asks for: whoever the book picks on its own,
 * the eldest named person, and a named leaf. The same choices `invariants.test.mjs` makes.
 */
function featuredChoices(doc) {
  const family = readFamily(doc, { now: NOW });
  const named = family.people.filter((p) => p.name);
  const byId = (a, b) => byKey(a.id, b.id);
  const eldest = [...named].sort((a, b) => ((a.by ?? Infinity) - (b.by ?? Infinity)) || byId(a, b))[0];
  const leaf = [...named.filter((p) => !family.childrenOf(p.id).length)]
    .sort((a, b) => ((b.by ?? 0) - (a.by ?? 0)) || byId(a, b))[0];
  return [undefined, eldest?.id, leaf?.id].filter((id, i) => i === 0 || id);
}

/* ------------------------------------------------------------------ every fixture, every F */

test('every hero page is a valid format-2 page, for every fixture and every featured person', async () => {
  for (const name of FIXTURES) {
    const doc = await loadFixture(name);
    for (const featured of featuredChoices(doc)) {
      const { book, report, plan } = await compose(name, featured ? { featured } : {});
      const where = `${name} / ${featured ?? 'most connected'}`;
      assert.deepEqual(validateBook(book), [], `${where}: not a valid Book`);
      assert.equal(book.format, 2, `${where}: a storybook that places art is format 2`);
      const drawn = heroPages(report);
      assert.ok(drawn.length >= 2, `${where}: a book always has a cover and a closing`);
      for (const p of drawn) {
        const planned = plan.pages[p.page - 1];
        assert.equal(p.variant, planned.variant, `${where} page ${p.page}: drew another variant than the plan's`);
        assert.deepEqual([...p.people], [...planned.people], `${where} page ${p.page}: drew other people than the plan's`);
        assert.equal(p.density, planned.density, `${where} page ${p.page}: a density the plan did not set`);
        assert.ok(texts(report, p.page).every((b) => b.kind), `${where} page ${p.page}: a line did not say what kind it is`);
      }
    }
  }
});

test('the hero pages keep the book\'s layout invariants', async () => {
  for (const name of FIXTURES) {
    const { book, report, family } = await compose(name);
    const mine = new Set(heroPages(report).map((p) => p.page));
    const ctx = { book, report, family, scope: new Set(family.people.map((p) => p.id)), year: YEAR };
    const failures = [];
    for (const [rule, { check }] of Object.entries(INVARIANTS)) {
      for (const v of check(ctx)) {
        const at = /page (\d+)/.exec(v);
        // A violation on a stub page belongs to whichever issue replaces that stub.
        if (!at || mine.has(Number(at[1]))) failures.push(`${rule}: ${v}`);
      }
    }
    assert.deepEqual(failures, [], name);
  }
});

test('the same tree drawn twice is the same bytes', async () => {
  const a = await compose('story-eldest');
  const b = await compose('story-eldest');
  assert.equal(JSON.stringify(a.book), JSON.stringify(b.book));
});

/* ------------------------------------------------------------------ the cover */

test('the cover lights one lamp for each person in scope, and not one more', async () => {
  for (const name of FIXTURES) {
    const { book, kin } = await compose(name);
    const lit = uses(book.pages[0].items).filter((ref) => LAMPS.includes(ref));
    assert.equal(lit.length, kin.people.size, `${name}: ${lit.length} lamps for ${kin.people.size} people`);
  }
});

test('a lamp for a name nobody knows is the dashed one, and only those', async () => {
  const { book, family, kin } = await compose('story-unknown-names');
  const unnamed = [...kin.people.keys()].filter((id) => !family.byId.get(id)?.name).length;
  const lit = uses(book.pages[0].items).filter((ref) => LAMPS.includes(ref));
  assert.ok(unnamed > 0, 'the fixture has people whose names are lost');
  assert.equal(lit.filter((r) => r === 'pc-diya-unknown').length, unnamed);
  assert.equal(lit.length - unnamed, kin.people.size - unnamed, 'everyone else is lit by an ordinary lamp');
});

test('no row of lamps overlaps itself, at any size of family', () => {
  const box = { x: 240, y: 514, w: 345, h: 216 };
  for (const n of [1, 2, 3, 7, 8, 12, 23, 47, 48, 49, 96, 150, 200, 400]) {
    const rows = lampRows(n, box);
    assert.equal(rows.reduce((t, r) => t + r.count, 0), n, `${n}: the rows hold somebody else's count`);
    assert.ok(rows.every((r) => r.count > 0), `${n}: an empty row`);
    for (const r of rows) {
      const spacing = r.count > 1 ? Math.abs(r.x2 - r.x1) / (r.count - 1) : Infinity;
      assert.ok(r.w <= spacing + 1e-9, `${n}: a lamp ${r.w} pt wide on a row spaced ${spacing}`);
      assert.ok(r.w >= MIN_LAMP, `${n}: a lamp only ${r.w.toFixed(1)} pt wide no longer reads as a lamp`);
      assert.ok(r.x1 >= box.x - 1e-9 && r.x2 <= box.x + box.w + 1e-9, `${n}: a row runs outside the lamps zone`);
      assert.ok(r.y >= box.y && r.y <= box.y + box.h, `${n}: a row sits outside the lamps zone`);
    }
  }
  assert.deepEqual(lampRows(0, box), [], 'nobody to light is no rows at all');
});

test('a cover with nobody to light does not claim a lamp for each of us', async () => {
  const { report, book } = await compose('story-empty');
  assert.equal(uses(book.pages[0].items).filter((r) => LAMPS.includes(r)).length, 0);
  assert.ok(!said(report, 1).includes('lamp'), said(report, 1));
  assert.ok(said(report, 1).includes(STORY_TEMPLATE.cover.greeting), 'the greeting is still there');
});

test('the cover is the family\'s: it names nobody, and reports nobody as shown', async () => {
  for (const name of ['story-large', 'story-eldest', 'story-tiny']) {
    const { report, family } = await compose(name);
    assert.equal(pageOf(report, 'cover').page, 1);
    for (const [id, pages] of Object.entries(report.shown)) assert.ok(!pages.includes(1), `${name}: the cover claims to show ${id}`);
    const words = said(report, 1);
    for (const p of family.people) if (p.name) assert.ok(!words.includes(p.name), `${name}: the cover prints ${p.name}`);
  }
});

test('the cover prints the family\'s own line, once', async () => {
  const { report, family } = await compose('story-eldest');
  const words = said(report, 1);
  assert.ok(family.title.startsWith('The ') && family.title.endsWith(' Family'), `the fixture's title is ${family.title}`);
  // "from the {family} family" over a title that is already "The Iyer Family" prints it twice.
  assert.ok(!/\bthe The\b/i.test(words), `the cover says the family's name twice: ${words}`);
  assert.ok(words.includes('from the Iyer family'), words);
});

test('the cover\'s greeting and family line stay large enough to read at 150 px', async () => {
  // A chat app shows the cover about 150 px wide, a quarter of A4's 595 pt (#240's approval gate).
  const SCALE = 150 / PAGE.w;
  for (const name of FIXTURES) {
    const { report, book } = await compose(name);
    const titles = texts(report, 1).filter((b) => b.kind === 'title');
    assert.equal(titles.length, 2, `${name}: the cover is a greeting and the family's line`);
    for (const b of titles) {
      assert.ok(b.size * SCALE >= 6.5, `${name}: ${b.s} prints at ${(b.size * SCALE).toFixed(1)} px on a phone`);
      assert.ok(b.x >= SAFE.x && b.x + b.w <= PAGE.w - SAFE.x, `${name}: ${b.s} runs outside the safe area`);
    }
    assert.equal(book.pages[0].label, STORY_TEMPLATE.cover.greeting);
  }
});

/* ------------------------------------------------------------------ the opening */

test('the opening says who the featured person is, in copy.js\'s own words', async () => {
  for (const name of ['story-eldest', 'story-large', 'story-devanagari', 'story-twelve-siblings']) {
    const { report, family, kin } = await compose(name);
    const page = pageOf(report, 'opening-hero');
    const sentence = openingLine(family, kin);
    assert.ok(sentence, `${name}: the fixture has an opening sentence`);
    // The sentence is broken into lines by the page, so it is read back the way it was written.
    const body = texts(report, page.page).filter((b) => b.kind === 'body').map((b) => b.s).join(' ');
    assert.equal(body, sentence, name);
    assert.deepEqual([...page.people], [kin.featured]);
  }
});

test('the opening\'s words stay inside the page, whatever the names are', async () => {
  for (const name of FIXTURES) {
    const doc = await loadFixture(name);
    for (const featured of featuredChoices(doc)) {
      const { report } = await compose(name, featured ? { featured } : {});
      const page = pageOf(report, 'opening-hero');
      if (!page) continue;
      for (const b of texts(report, page.page)) {
        if (b.kind === 'folio') continue;   // page furniture sits in the margin on purpose
        assert.ok(b.x >= SAFE.x - 0.5 && b.x + b.w <= PAGE.w - SAFE.x + 0.5, `${name}: "${b.s}" runs off the side`);
        assert.ok(b.y >= SAFE.y && b.y + b.h <= SAFE.y + SAFE.h, `${name}: "${b.s}" runs off the top or foot`);
      }
    }
  }
});

test('an opening that folds the chapters above it says the book begins here', async () => {
  const { report, plan } = await compose('one-person');
  const page = pageOf(report, 'opening-hero');
  assert.deepEqual([...plan.pages[page.page - 1].folds], ['roots', 'courtyards'], 'the fixture folds its roots in');
  assert.match(said(report, page.page), /is the first name this family remembers/);
});

/* ------------------------------------------------------------------ the waiting page */

test('a book with nobody to feature waits for its family, and invents no one', async () => {
  const { report, book } = await compose('story-empty');
  const page = pageOf(report, 'waiting');
  assert.equal(page.page, 2);
  assert.deepEqual([...page.people], []);
  assert.deepEqual(report.shown, {});
  const words = said(report, 2);
  assert.match(words, /waiting for its family/);
  assert.match(words, /Add the people you remember/);
  // The template's opening copy is written round a person this book has not got: filling it would
  // print "This is." (copy.js drops the placeholder, not the sentence round it).
  assert.ok(!words.includes('This is'), words);
  assert.ok(uses(book.pages[1].items).includes('pc-arch-jharokha'), 'the window is still there');
});

/* ------------------------------------------------------------------ a portrait hero */

/** Draws one archetype where another was planned, so any fixture can exercise it. */
const insteadOf = (planned, archetype, patch = {}) => withStubs({
  ...PAGES,
  [planned]: (ctx, page, story) => PAGES[archetype](ctx, { ...page, archetype, ...patch }, story),
});

test('the mala hangs on a departed person\'s frame, and on nobody else\'s', async () => {
  const dead = await compose('story-twelve-siblings');
  const page = pageOf(dead.report, 'portrait-hero');
  const people = page.people.map((id) => dead.family.byId.get(id));
  assert.ok(people.every((p) => p.deceased), 'the fixture\'s portrait hero is two departed people');
  const hung = uses(dead.book.pages[page.page - 1].items).filter((r) => r === 'pc-mala-departed');
  assert.equal(hung.length, people.length);

  const living = await compose('story-tiny');
  const lp = pageOf(living.report, 'portrait-hero');
  assert.ok(lp.people.every((id) => !living.family.byId.get(id).deceased), 'the fixture\'s portrait hero is living');
  assert.ok(!uses(living.book.pages[lp.page - 1].items).includes('pc-mala-departed'), 'a garland by a living person');
});

/** Where a `use` of `id` lands on the page, from its transform and the drawing's own viewBox. */
function whereUsed(items, id) {
  const found = [];
  const walk = (list) => {
    for (const it of list ?? []) {
      if (it.t === 'group') walk(it.items);
      if (it.t !== 'use' || it.ref !== id) continue;
      const [a, b, c, d, e, f] = it.tf ?? [1, 0, 0, 1, 0, 0];
      const [vx, vy, vw, vh] = LIBRARY.symbols[id.replace(/^pc-/, '')].vb;
      const xs = [], ys = [];
      for (const [x, y] of [[vx, vy], [vx + vw, vy], [vx, vy + vh], [vx + vw, vy + vh]]) {
        xs.push(a * x + c * y + e);
        ys.push(b * x + d * y + f);
      }
      found.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
    }
  };
  walk(items);
  return found;
}

test('a departed person\'s mala hangs on the frame, never across the name under it', async () => {
  const { report, book, family } = await compose('story-eldest');
  const page = pageOf(report, 'portrait-hero');
  assert.equal(page.people.filter((id) => family.byId.get(id).deceased).length, 1, 'the fixture has one departed parent');
  const [mala] = whereUsed(book.pages[page.page - 1].items, 'pc-mala-departed');
  assert.ok(mala, 'no mala on a departed person\'s frame');
  for (const b of texts(report, page.page)) {
    const over = Math.min(b.x + b.w, mala.x + mala.w) - Math.max(b.x, mala.x) > 0.5
      && Math.min(b.y + b.h, mala.y + mala.h) - Math.max(b.y, mala.y) > 0.5;
    assert.ok(!over, `the garland hangs across "${b.s}"`);
  }
});

test('a person with no photograph is never given a face, and one with no name is a lamp', async () => {
  const { book, family, report } = await compose('story-unknown-names', {}, insteadOf('gathering', 'portrait-hero', {
    variant: 'niche', density: 'hero',
  }));
  const page = report.pages.find((p) => p.archetype === 'portrait-hero');
  const placed = uses(book.pages[page.page - 1].items);
  const unnamed = page.people.filter((id) => !family.byId.get(id)?.name);
  assert.ok(unnamed.length, 'the fixture puts a person with no name on this page');
  assert.equal(placed.filter((r) => r === 'pc-lamp-unknown').length, unnamed.length, 'a name nobody knows is a lit lamp');
  // Nobody in these fixtures has a photograph, so every face on the page would be an invented one.
  assert.ok(family.people.every((p) => !p.photo));
  assert.ok(!placed.some((r) => r.startsWith('pc-avatar-') && unnamed.length === page.people.length), 'a face on a person with no record');
});

test('a note appears beside a portrait only when the reader asked for one', async () => {
  const noted = readFamily(await loadFixture('story-notes'), { now: NOW, notes: true }).people.find((p) => p.note);
  assert.ok(noted, 'the fixture has a note');
  const pages = insteadOf('gathering', 'portrait-hero', { variant: 'arch', density: 'hero', people: [noted.id] });
  const at = (r) => r.pages.find((p) => p.archetype === 'portrait-hero').page;
  const first = noted.note.split('\n')[0];
  const on = await compose('story-notes', { notes: true }, pages);
  assert.ok(said(on.report, at(on.report)).includes(first), 'the note is not on the page');
  const off = await compose('story-notes', {}, pages);
  assert.ok(!said(off.report, at(off.report)).includes(first), 'a note nobody asked for');
});

/* ------------------------------------------------------------------ the closing */

test('the closing carries its own farewell, the call to action, the QR code and the credit', async () => {
  const { report, book } = await compose('story-eldest');
  const page = pageOf(report, 'closing');
  assert.equal(page.page, book.pages.length, 'the closing is the last page');
  const words = said(report, page.page);
  // Round 2, finding 19: the closing used to reprint the cover's own greeting word for word ("the
  // last page says what the first said"). Its farewell is the template's own, and distinct.
  assert.ok(words.includes(STORY_TEMPLATE.copy.closing.title), 'no farewell');
  assert.notEqual(STORY_TEMPLATE.copy.closing.title, STORY_TEMPLATE.cover.greeting, 'the farewell repeats the cover\'s own greeting');
  assert.ok(!words.includes(STORY_TEMPLATE.cover.greeting), 'the closing still says what the cover said');
  assert.match(words, /Is someone missing\?/);
  assert.match(words, /Scan to get f-tree/);
  assert.match(words, /Made with f-tree/);
  // The code itself: one long path of dark modules, drawn where the scene keeps room for it.
  const qr = book.pages[page.page - 1].items.filter((it) => it.t === 'path' && it.d.length > 2000);
  assert.equal(qr.length, 1, 'the QR code is not on the page');
});

test('the closing sets its farewell and invitation in the book\'s own hand, not a report\'s', async () => {
  // Round 2, finding 15: the invitation used to be set in `text`, the driest voice the book has,
  // and the page carried no `hand` face at all.
  const { report, book } = await compose('story-eldest');
  const page = pageOf(report, 'closing');
  assert.ok(texts(report, page.page).length, 'the closing has no text at all');
  const farewell = book.pages[page.page - 1].items.find((it) => it.t === 'text' && it.s === STORY_TEMPLATE.copy.closing.title);
  assert.ok(farewell, 'the farewell is not on the page');
  assert.equal(farewell.font, 'hand', 'the farewell is not set in the book\'s own hand');
});

test('nothing on the closing page is drawn over the QR code', async () => {
  const { report, book } = await compose('story-eldest');
  const page = pageOf(report, 'closing');
  const items = book.pages[page.page - 1].items;
  const plate = items.find((it) => it.t === 'rect' && it.r !== undefined);
  assert.ok(plate, 'the QR sits on a plate');
  const over = (b) => Math.min(b.x + b.w, plate.x + plate.w) - Math.max(b.x, plate.x) > 0.5
    && Math.min(b.y + b.h, plate.y + plate.h) - Math.max(b.y, plate.y) > 0.5;
  for (const b of texts(report, page.page)) assert.ok(!over(b), `"${b.s}" prints across the QR code`);
  // The folio's own lamp is art, not text, and it sits in the same corner of the page.
  for (const b of whereUsed(items, 'pc-diya-small')) assert.ok(!over(b), 'the folio lamp sits on the QR code');
});

/* ------------------------------------------------------------------ the variants */

test('every hero archetype draws both of the variants plan.js lists for it', async () => {
  for (const archetype of MINE) {
    const fixture = archetype === 'waiting' ? 'story-empty' : 'story-eldest';
    const planned = archetype === 'portrait-hero' ? 'portrait-hero' : archetype;
    const seen = new Set();
    for (const variant of VARIANTS[archetype]) {
      const { book, report } = await compose(fixture, {}, insteadOf(planned, archetype, { variant }));
      const page = report.pages.find((p) => p.archetype === archetype && p.variant === variant);
      assert.ok(page, `${archetype}/${variant} did not draw`);
      assert.deepEqual(validateBook(book), [], `${archetype}/${variant}`);
      const drawn = JSON.stringify(book.pages[page.page - 1]);
      assert.ok(!seen.has(drawn), `${archetype}: ${variant} draws exactly what the last variant drew`);
      seen.add(drawn);
      assert.ok(texts(report, page.page).every((b) => b.kind), `${archetype}/${variant}: a line with no kind`);
    }
  }
});

/* ------------------------------------------------------------------ round 2 design critique */

test('finding 1: the mala hangs below the arch frame, never across the sitter’s chest', async () => {
  const { report, book } = await compose('story-eldest');
  const page = pageOf(report, 'portrait-hero');
  assert.equal(page.variant, 'arch', 'precondition: the fixture’s portrait hero is an arch');
  const face = report.artZones.find((z) => z.page === page.page && z.kind === 'face');
  assert.ok(face, 'no face zone recorded');
  // whereUsed's bbox is the mala's whole viewBox, which reaches well above its own anchor (empty
  // canvas the source never draws in) - not a useful proxy here. The anchor point itself
  // (the drawing's own (50, 50), art/README.md) is where the fix actually moved.
  let anchorY = null;
  (function walk(list) {
    for (const it of list ?? []) {
      if (it.t === 'group') walk(it.items);
      if (it.t === 'use' && it.ref === 'pc-mala-departed') {
        const [a, b, c, d, e, f] = it.tf ?? [1, 0, 0, 1, 0, 0];
        anchorY = b * 50 + d * 50 + f;
      }
    }
  }(book.pages[page.page - 1].items));
  assert.ok(anchorY !== null, 'no mala on the departed parent’s frame');
  assert.ok(anchorY >= face.y + face.h - 1, `the mala’s own anchor sits inside the face zone (anchor.y=${anchorY}, face foot=${face.y + face.h})`);
});

test('finding 2: the opening arch is built into a haveli facade, not floating on bare paper', async () => {
  const { report, book } = await compose('story-eldest');
  const page = pageOf(report, 'opening-hero');
  const refs = uses(book.pages[page.page - 1].items);
  assert.ok(refs.includes('pc-peepal'), 'no peepal vine in the facade’s corners');
  assert.ok(refs.filter((r) => r === 'pc-diya-small').length >= 2, 'no diyas along the parapet or in its niches');
});

test('finding 3: the arch view is a scene - a skyline and a river - not a gradient and a stray flame', async () => {
  const { report, book } = await compose('story-eldest');
  const page = pageOf(report, 'opening-hero');
  const all = flatItems(book.pages[page.page - 1].items);
  assert.ok(all.some((it) => it.t === 'rect' && it.fill === PAPERCUT_PALETTE.wash), 'no wash river band in the view');
  assert.ok(all.some((it) => it.t === 'path' && it.fill === PAPERCUT_PALETTE.stone), 'no skyline silhouette in the view');
});

test('finding 4: lamp rows tilt and interleave, and the near rows light the leaf-boat lamp', () => {
  const box = { x: 240, y: 514, w: 345, h: 216 };
  const rows = lampRows(96, box);
  assert.ok(rows.some((r) => r.y1 !== r.y2), 'every row is still a flat, ruled line');
  assert.ok(rows.some((r) => r.boat), 'no row lights the leaf-boat variant');
  for (const r of rows) {
    assert.ok(r.y1 >= box.y - 1e-6 && r.y1 <= box.y + box.h + 1e-6, `a tilted row's near end (${r.y1}) runs outside the lamps zone`);
    assert.ok(r.y2 >= box.y - 1e-6 && r.y2 <= box.y + box.h + 1e-6, `a tilted row's far end (${r.y2}) runs outside the lamps zone`);
  }
});

test('finding 5: the ghat figures read as separate people, not a row of bollards', async () => {
  const { book } = await compose('story-eldest');
  const figureUses = flatItems(book.pages[0].items).filter((it) => it.t === 'use' && it.ref?.startsWith('pc-hero-') && it.fill);
  assert.equal(figureUses.length, 4, 'the ghat still has four figures');
  const tints = new Set(figureUses.map((it) => it.fill));
  // `haze`, `deep`, `glow` and `night` are four distinct token NAMES but four near-identical dark
  // violets (book-design-system.md's own palette table lists them together) - checking the resolved
  // hexes stay clear of the two round 2 dropped (`haze`, `night`) is what actually distinguishes
  // the fix from the bug; a bare count of distinct strings would pass on the old four just as well.
  assert.ok(tints.size <= 3, `${tints.size} distinct tints - four is what the bug looked like`);
  assert.ok(!tints.has(PAPERCUT_PALETTE.haze) && !tints.has(PAPERCUT_PALETTE.night), 'still using one of the two near-duplicate tones');
  // A gold shoulder stripe on every figure (the finding's other ask).
  const stripes = flatItems(book.pages[0].items).filter((it) => it.t === 'path' && it.stroke === PAPERCUT_PALETTE.gold && it.op === 0.45);
  assert.equal(stripes.length, 4, 'not every ghat figure has a cloth border stripe');
});

test('finding 6: the cover keeps a warm heart even when only the near lamps carry their own glow', async () => {
  const { book } = await compose('story-large');
  const glows = flatItems(book.pages[0].items)
    .filter((it) => it.t === 'circle' && it.op !== undefined && (it.fill === PAPERCUT_PALETTE.flame || it.fill === PAPERCUT_PALETTE.gold));
  assert.ok(glows.length >= 6, 'no zone-scale glow laid over the lamps');
});

test('finding 7: a photograph that cannot draw in an arch still shows the hero, mounted, never a blank lit window', async () => {
  const { report, book, family } = await compose('sample', { photos: true });
  const page = pageOf(report, 'opening-hero');
  const person = family.byId.get(page.people[0]);
  assert.ok(person?.photo, 'precondition: the opening’s subject has a photograph on record');
  const items = book.pages[page.page - 1].items;
  const refs = uses(items);
  assert.ok(refs.some((r) => r.startsWith('pc-hero-')), 'no fallback figure drawn under the photograph');
  const all = flatItems(items);
  assert.ok(all.some((it) => it.t === 'image'), 'no photograph placed');
  assert.ok(all.some((it) => it.t === 'rect' && it.stroke === PAPERCUT_PALETTE.gold), 'no gold line mounting the photograph');
  assert.ok(all.some((it) => it.t === 'rect' && it.fill === PAPERCUT_PALETTE.card), 'no cream mat around the photograph');
});

test('finding 8: the closing’s QR code is mounted - a mat, a gold hairline, a caption underneath', async () => {
  const { report, book } = await compose('story-eldest');
  const page = pageOf(report, 'closing');
  const items = book.pages[page.page - 1].items;
  const mat = items.find((it) => it.t === 'rect' && it.r !== undefined);
  assert.ok(mat, 'no mounting mat for the QR code');
  assert.ok(items.some((it) => it.t === 'rect' && it.stroke === PAPERCUT_PALETTE.gold), 'no gold hairline around the QR code');
  assert.ok(items.some((it) => it.t === 'rect' && it.fill === PAPERCUT_PALETTE.ink), 'no paper shadow under the QR plate');
  const caption = texts(report, page.page).find((b) => b.s === 'Scan to get f-tree');
  assert.ok(caption, 'no caption');
  assert.ok(caption.y > mat.y + mat.h, 'the caption floats beside the plate rather than sitting under it');
});

test('finding 9: heroTint varies an adult or elder hero’s cloth by a stable hash of the id', () => {
  const stage = { year: 2026 };
  const elders = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, by: 1950 }));
  const tints = elders.map((p) => heroTint(p, stage));
  assert.ok(tints.every(Boolean), 'an adult or elder got no tint at all');
  assert.equal(heroTint(elders[0], stage), heroTint(elders[0], stage), 'the same id gets a different tint on a second look');
  assert.ok(new Set(tints).size >= 2, 'every elder still wears the identical kurta');
  assert.equal(heroTint({ id: 'child', by: 2020 }, stage), null, 'a child hero - whose figure a plain overlay cannot line up with - still gets retinted');
});

test('finding 11: the Sanjhi band’s colour varies by chapter, and the tailpiece takes more than one form', () => {
  const tints = new Set(['opening', 'parents', 'siblings', 'spouses', 'children', 'courtyards'].map((c) => bandTint(`Test Family ${c}`)));
  assert.ok(tints.size >= 2, 'every chapter still gets the same band colour');

  const fakeArt = { place: (id) => ({ t: 'use', ref: `pc-${id}` }) };
  const forms = new Set();
  for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
    forms.add(tailpiece({ art: fakeArt }, 100, 200, seed).map((it) => it.ref).join(','));
  }
  assert.ok(forms.size >= 2, 'the tailpiece still closes every page with the same two shapes at the same spot');
});

test('finding 13: the handmade paper’s clouds composite as one layer, not one blend per overlap', () => {
  const g = paperGround({ P: PAPERCUT_PALETTE }, 'Test Family');
  assert.equal(g.t, 'group');
  assert.equal(g.op, 0.18, 'the clouds no longer carry one shared opacity');
  assert.ok(g.items.every((it) => it.op === undefined), 'a cloud still carries its own opacity, which compounds where two overlap');
});

test('finding 14: the two arches turn to face each other, so the suns do not land on the same side', async () => {
  /*
   * Round 2 turned the second arch's whole group AND passed `mirror` into its view. The two
   * negations cancelled - the sun moved left, the flip put it back - so both suns sat on the same
   * side of their arches and the pair still read as a copy and a paste. The old test here asserted
   * only that *some* group carried tf[0] === -1, which the bug passed, so it never said anything.
   *
   * The view is drawn unmirrored now and the group flip alone does the turning, which puts the two
   * suns symmetrically about the page's spine. That is the property worth pinning: it is false the
   * moment either half of the mirroring comes back.
   */
  const { family } = await compose('story-eldest');
  const two = family.people.filter((p) => p.name).slice(0, 2).map((p) => p.id);
  const pages = insteadOf('gathering', 'portrait-hero', { variant: 'arch', density: 'hero', people: two });
  const { book, report } = await compose('story-eldest', {}, pages);
  const page = book.pages[pageOf(report, 'portrait-hero').page - 1];

  assert.ok(page.items.some((it) => it.t === 'group' && it.tf && it.tf[0] === -1),
    'neither arch is mirrored - the pair still reads as a copy and a paste');

  /*
   * Every sun on the page in page coordinates. A flipped group maps x to (e - x), where e is the
   * transform's own translate. The suns are the flame discs the views draw; the faint flame circles
   * at the spine are the diya's halo between a couple, which is why opacity tells them apart.
   */
  const suns = [];
  const walk = (items, flip) => {
    for (const it of items ?? []) {
      if (it.t === 'group') walk(it.items, it.tf && it.tf[0] === -1 ? it.tf[4] : flip);
      else if (it.t === 'circle' && it.fill === PAPERCUT_PALETTE.flame && it.op > 0.5) suns.push(flip === null ? it.cx : flip - it.cx);
    }
  };
  walk(page.items, null);
  assert.equal(suns.length, 2, `expected one sun in each arch, found ${suns.length}`);

  const off = Math.abs((suns[0] + suns[1]) / 2 - PAGE.w / 2);
  assert.ok(off < 3, `the two suns sit ${off.toFixed(1)} pt off the page's spine, so both are on the same side of their own arch`);
});

test('finding 16: the sill diyas have a darker halo to sit against, not pale flame on a pale wall', async () => {
  const { report, book } = await compose('story-eldest');
  const page = pageOf(report, 'opening-hero');
  const halo = book.pages[page.page - 1].items.some((it) => it.t === 'circle' && it.fill === PAPERCUT_PALETTE.clay && it.op !== undefined);
  assert.ok(halo, 'no clay halo behind the sill lamps');
});

test('finding 17: the opening carries a kin medallion row, the reader’s first sight of the family', async () => {
  const { report, book } = await compose('story-eldest');
  const page = pageOf(report, 'opening-hero');
  const medallions = uses(book.pages[page.page - 1].items).filter((r) => r === 'pc-medallion').length;
  assert.ok(medallions >= 1, 'no kin medallions on the opening');
});

test('finding 18: the diya between a bereaved couple stands on the sill, with its own glow', () => {
  const fakeCtx = {
    P: PAPERCUT_PALETTE,
    art: { place: (id, o) => ({ t: 'use', ref: `pc-${id}`, x: o.x, y: o.y }) },
    family: { spousesOf: () => [{ id: 'b' }] },
  };
  const items = joinFrames(fakeCtx, { id: 'a', deceased: true }, { id: 'b', deceased: false }, { cx: 100, y: 300, width: 80 });
  const diya = items.find((it) => it.t === 'use' && it.ref === 'pc-diya');
  assert.ok(diya, 'no diya between the bereaved couple');
  assert.equal(diya.y, 300, 'the diya does not stand on the sill line it was given');
  assert.ok(items.length > 1, 'no glow behind the diya');
});

test('finding 20: the cover line carries the count in words, and {Count-words} is legal at format 2', async () => {
  assert.doesNotThrow(() => validateTemplate(STORY_TEMPLATE), '{Count-words} is not a legal format-2 placeholder');
  const { report, kin } = await compose('story-eldest');
  const words = said(report, 1);
  const n = kin.people.size;
  if (n !== 1) assert.ok(words.includes(`${countWords(n, true)} lamps, one for each of us.`), words);
});

test('finding 21: the opening title says whose story it is, and the body never repeats the name a second time', async () => {
  const { report, family, kin } = await compose('story-eldest');
  const page = pageOf(report, 'opening-hero');
  const name = family.byId.get(kin.featured)?.name;
  const title = texts(report, page.page).find((b) => b.kind === 'title');
  assert.equal(title?.s, `This is ${name}'s story`, `the title does not say whose story this is: ${title?.s}`);
  // The body opens with the subject's own name, as any sentence about them would - the bug was
  // its OWN ending saying "This is the family behind {name}" a second time.
  const body = texts(report, page.page).filter((b) => b.kind === 'body').map((b) => b.s).join(' ');
  assert.equal((body.match(new RegExp(name, 'g')) ?? []).length, 1, `the body says ${name} more than once: ${body}`);
});

test('finding 22: yearsCaption marks a bare year "b." so it never reads as a death year', async () => {
  const { family, kin } = await compose('story-eldest');
  const living = family.people.find((p) => p.name && !p.deceased && p.by);
  assert.ok(living, 'precondition: a living named person with a birth year');
  const caption = yearsCaption({ family, options: {} }, { kin }, living);
  assert.ok(caption.includes(`b. ${living.by}`), caption);
});

test('finding 23: the parents chapter’s title is English; the kin words stay in hand under a name', () => {
  assert.doesNotMatch(STORY_TEMPLATE.copy.parents.title, /[ऀ-ॿ]/, 'the parents title still carries Devanagari in the display face');
});

test('finding 12: the folio sits at the outer foot, alternating by page parity at format 2 only', async () => {
  const { report, book } = await compose('story-eldest');
  assert.ok(book.pages.length >= 4, 'the fixture needs at least two interior pages to compare');
  const numberOn = (pageNo) => {
    const folio = texts(report, pageNo).find((b) => b.kind === 'folio' && /^\d+$/.test(b.s));
    assert.ok(folio, `no page number on page ${pageNo}`);
    return folio.x < PAGE.w / 2 ? 'left' : 'right';
  };
  assert.equal(numberOn(3), 'right', 'an odd (recto) page does not put its folio at the right');
  assert.equal(numberOn(2), 'left', 'an even (verso) page does not mirror its folio to the left');

  // Format 1 must keep its fixed corners - moving them would move Heirloom's goldens.
  const doc = await loadFixture('story-eldest');
  const heirloom = composeBook(doc, { now: NOW }, TEMPLATES.heirloom);
  // The folio's own number, not any other digit a page prints: `ctx.footer` sets it at y = H - 22.
  const folioNumber = (page) => page.items.find((it) => it.t === 'text' && /^\d+$/.test(it.s) && Math.abs(it.y - (PAGE.h - 22)) < 1);
  const p2 = folioNumber(heirloom.pages[1]), p3 = folioNumber(heirloom.pages[2]);
  assert.ok(p2 && p3, 'the format-1 book has no folio number on its interior pages to compare');
  assert.equal(p2.x, p3.x, 'format 1 moved its folio - Heirloom’s goldens would move with it');
});

/*
 * Round 2, second pass: the zone glow that finding 6 added lit the rows it was meant to light at
 * 200 people and, at 15, put two hard halos in empty water - the loudest objects on the cover the
 * issue's own acceptance criterion judges at 150 px. The rule is that a glow belongs over lamps
 * that do not glow by themselves, and nowhere else.
 */
test('a zone glow only ever sits over a row of lamps that does not light itself', () => {
  const box = { x: 40, y: 400, w: 520, h: 300 };
  for (const n of [1, 2, 7, 15, 23, 48, 120, 200]) {
    const rows = lampRows(n, box);
    const warm = rowsToWarm(rows);
    assert.ok(warm.length <= 2, `${n}: ${warm.length} glows`);
    assert.equal(new Set(warm).size, warm.length, `${n}: the same row is warmed twice`);
    for (const row of warm) {
      assert.ok(rows.includes(row), `${n}: a glow sits over no row at all`);
      assert.ok(!row.boat && row.w < 16, `${n}: a glow sits over lamps that already carry a flame`);
    }
  }
});

test('a family small enough that every lamp lights itself gets no zone glow', () => {
  // story-eldest is this case: its rows are leaf boats and full-size diyas, so two discs placed at
  // fixed fractions of the zone lit nothing and drowned the lamps at thumbnail size.
  const box = { x: 40, y: 400, w: 520, h: 300 };
  assert.deepEqual(rowsToWarm(lampRows(15, box)), [], 'fifteen lamps were given a zone halo');
  assert.deepEqual(rowsToWarm(lampRows(23, box)), [], 'a twenty-three lamp cover was given one too');
  assert.ok(rowsToWarm(lampRows(200, box)).length > 0, 'a crowd of lamps lost its warmth');
});

/*
 * Ankit's decision 4: the cover carries the count in the approved form, and two things follow from
 * it - the singular must read as English ("1 lamps" is the failure it names), and a count of zero
 * or none must fall back to the cover's plain form rather than printing a number nobody can use.
 */
test('the cover never prints a bad count: no "1 lamps", and nothing numeric with nobody to count', () => {
  const template = validateTemplate(STORY_TEMPLATE);
  const textOf = (book) => book.pages[0].items.filter((i) => i.t === 'text').map((i) => i.s ?? i.text).filter(Boolean).join(' | ');

  const one = textOf(composeBook({ format: 1, people: [{ id: 'a', name: 'Asha' }], links: [] }, { now: NOW }, template));
  assert.ok(!/\b1 lamps\b/.test(one), `the cover said "1 lamps": ${one}`);
  assert.match(one, /One lamp\b/, `a family of one should say one lamp: ${one}`);

  const none = textOf(composeBook({ format: 1, people: [], links: [] }, { now: NOW }, template));
  assert.ok(!/\d/.test(none.replace(/Made with f-tree/g, '')), `the cover printed a number with nobody to count: ${none}`);
  assert.ok(!/\blamps?\b/i.test(none), `the cover counted lamps with nobody to count: ${none}`);
});
