/*
 * story/plan.js: the story planner (#251).
 *
 * Golden-style tests over the storybook fixtures (#245's story-*.json): each fixture's page
 * sequence is written out below, so a change to the planner's rules shows up as a readable diff of
 * which pages a family gets. Then the properties every plan must keep on every fixture and several
 * featured people - numbering, variety, density, continuation, completeness, stability - and the
 * split/merge boundaries, the cap, and the adaptations to family shape on families built for them.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { planStory, splitBalanced, CHAPTERS, MAX_STORY_PAGES, MIN_CONTINUATION, TINY, DENSITY, VARIANTS } from './story/plan.js';
import { kinOf } from './story/kin.js';
import { readFamily, byKey } from './family.js';
import { resolveFeatured } from './story/featured.js';
import { validateTemplate, REQUIRED_CHAPTERS, PAPERCUT_PALETTE_KEYS, HAND_FONT_KEY } from './template.js';
import { composeBook } from './compose.js';
import { BOOK_FIXTURES, NOW, loadFixture } from './qa/book-fixtures.mjs';
import { DENSITY_CAPS, pageBounds } from './qa/invariants.mjs';

/** A format-2 template listing `chapters`, valid by template.js's own rules. */
function storyTemplate(chapters = CHAPTERS) {
  return validateTemplate({
    format: 2, id: 'diwali-story', name: 'Diwali, the storybook', fileSuffix: 'Book', art: 'papercut',
    fonts: { display: 'book_display', text: 'book_text', strong: 'book_strong', hand: HAND_FONT_KEY },
    palette: Object.fromEntries(PAPERCUT_PALETTE_KEYS.map((k) => [k, '#112233'])),
    cover: { greeting: 'शुभ दीपावली', subtitle: 'from the {family} family', line: 'One lamp for each of us' },
    story: { chapters: [...chapters] },
    copy: {},
  });
}
const TEMPLATE = storyTemplate();

const plan = (doc, featured, options = {}) => {
  const family = readFamily(doc, { now: NOW });
  const F = resolveFeatured(family, { ...(featured ? { featured } : {}) });
  return { family, plan: planStory(kinOf(family, F), options.template ?? TEMPLATE, family, options) };
};

/** A plan as one readable line a page: chapters (' when continued), archetype, people. */
const summary = (p) => p.pages.map((pg) => `${pg.chapters.join('+')}${pg.continued ? "'" : ''} ${pg.archetype} ${pg.people.length}`);
const storyPages = (p) => p.pages.filter((pg) => pg.archetype !== 'register');

/* ------------------------------------------------------------------ building families */

const M = (id, name, birthDate) => ({ id, name, gender: 'MALE', birthDate });
const W = (id, name, birthDate) => ({ id, name, gender: 'FEMALE', birthDate });
const parents = (a, b, ...children) => children.flatMap((to) => [{ type: 'PARENT', from: a, to }, { type: 'PARENT', from: b, to }]);
const married = (a, b) => ({ type: 'SPOUSE', from: a, to: b, subtype: 'MARRIED' });
const tree = (people, relationships) => ({ format: 'f-tree', version: 1, people, relationships: relationships.flat().map((r, i) => ({ id: `r${i}`, ...r })) });

/** F, two parents, and `n` siblings. */
const withSiblings = (n) => {
  const sibs = Array.from({ length: n }, (_, i) => M(`s${String(i).padStart(2, '0')}`, `Sibling ${i}`, String(1980 + i)));
  return tree([M('f', 'Ankit', '1995'), M('dad', 'Rajesh', '1960'), W('mum', 'Sunita', '1962'), ...sibs],
    [parents('dad', 'mum', 'f', ...sibs.map((s) => s.id)), married('dad', 'mum')]);
};

/* ------------------------------------------------------------------ the catalogue schema */

test('chapter ids are the catalogue schema\'s: the required four, all valid ids, and a full template validates', () => {
  for (const c of REQUIRED_CHAPTERS) assert.ok(CHAPTERS.includes(c), c);
  for (const c of CHAPTERS) assert.match(c, /^[a-z0-9-]+$/);
  assert.deepEqual(TEMPLATE.story.chapters, CHAPTERS);
});

test('a chapter the planner does not know is refused by name, not skipped', () => {
  const t = storyTemplate([...REQUIRED_CHAPTERS, 'fireworks']);
  const family = readFamily(withSiblings(1), { now: NOW });
  assert.throws(() => planStory(kinOf(family, 'f'), t, family), /does not know the chapter "fireworks" in template "diwali-story"/);
});

test('a chapter the template leaves out gets no page', () => {
  const { plan: p } = plan(withSiblings(4), 'f', { template: storyTemplate(['cover', 'opening', 'register', 'closing']) });
  assert.deepEqual(p.pages.map((pg) => pg.chapter), ['cover', 'opening', 'register', 'closing']);
});

/* ------------------------------------------------------------------ golden sequences */

// Featuring `f`, every fixture's pages. Read a line as: chapters (' continued), archetype, people.
const GOLDEN = {
  'story-devanagari': ['cover cover 0', 'opening opening-hero 1', 'courtyards courtyards 4', 'parents gathering 4', 'siblings+spouses+children gathering 3', 'lane lane 2', 'numbers numbers 0', 'register register 12', 'still-to-be-found still-to-be-found 1', 'legacy legacy 1', 'closing closing 0'],
  'story-eldest': ['cover cover 0', 'opening opening-hero 1', 'spouses portrait-hero 1', 'children gathering 6', "children' gathering 7", 'numbers numbers 0', 'register register 15', 'legacy legacy 1', 'closing closing 0'],
  'story-empty': ['cover cover 0', 'opening waiting 0', 'closing closing 0'],
  'story-half-siblings': ['cover cover 0', 'opening opening-hero 1', 'courtyards courtyards 1', 'parents gathering 4', 'siblings gathering 5', 'lane lane 2', 'numbers numbers 0', 'register register 13', 'legacy legacy 1', 'closing closing 0'],
  'story-large': ['cover cover 0', 'opening opening-hero 1', 'roots banyan 8', 'courtyards courtyards 4', 'parents gathering 8', 'siblings gathering 4', 'spouses gathering 3', 'children gathering 6',
    'lane lane 15', "lane' lane 24", "lane' lane 22", "lane' lane 24", "lane' lane 27", "lane' lane 24", "lane' lane 20", "lane' lane 16",
    'numbers numbers 0', 'register register 39', "register' register 47", "register' register 45", "register' register 47", "register' register 22",
    'still-to-be-found still-to-be-found 3', 'legacy legacy 1', 'closing closing 0'],
  'story-leaf': ['cover cover 0', 'opening opening-hero 1', 'courtyards courtyards 4', 'parents gathering 4', 'siblings portrait-hero 1', 'lane lane 2', 'numbers numbers 0', 'register register 10', 'legacy legacy 1', 'closing closing 0'],
  'story-notes': ['cover cover 0', 'opening opening-hero 1', 'spouses+children gathering 4', 'register register 5', 'legacy legacy 1', 'closing closing 0'],
  'story-three-spouses': ['cover cover 0', 'opening opening-hero 1', 'parents portrait-hero 1', 'spouses gathering 3', 'children gathering 4', 'numbers numbers 0', 'register register 9', 'legacy legacy 1', 'closing closing 0'],
  'story-tiny': ['cover cover 0', 'opening opening-hero 1', 'parents portrait-hero 2', 'register register 3', 'legacy legacy 1', 'closing closing 0'],
  'story-twelve-siblings': ['cover cover 0', 'opening opening-hero 1', 'parents portrait-hero 2', 'siblings gathering 5', "siblings' gathering 6", 'numbers numbers 0', 'register register 14', 'legacy legacy 1', 'closing closing 0'],
  'story-unknown-names': ['cover cover 0', 'opening opening-hero 1', 'roots+courtyards+parents+children gathering 6', 'numbers numbers 0', 'register register 7', 'still-to-be-found still-to-be-found 4', 'legacy legacy 1', 'closing closing 0'],
  'story-unlinked': ['cover cover 0', 'opening opening-hero 1', 'register register 5', 'legacy legacy 1', 'closing closing 0'],
};
const STORY_FIXTURES = Object.keys(BOOK_FIXTURES).filter((n) => n.startsWith('story-'));

test('golden: every storybook fixture has a sequence here, and no stale one', () => {
  assert.deepEqual(Object.keys(GOLDEN).sort(), [...STORY_FIXTURES].sort());
});

for (const name of STORY_FIXTURES) {
  test(`golden: ${name}`, async () => {
    const doc = await loadFixture(name);
    const { plan: p } = plan(doc, doc.people?.some((x) => x.id === 'f') ? 'f' : undefined);
    assert.deepEqual(summary(p), GOLDEN[name]);
  });
}

/* ------------------------------------------------------------------ properties, everywhere */

/** Several featured people per fixture: the most connected, the eldest, a leaf, and `f`. */
function choices(doc) {
  const family = readFamily(doc, { now: NOW });
  const named = family.people.filter((p) => p.name);
  const eldest = [...named].sort((a, b) => ((a.by ?? Infinity) - (b.by ?? Infinity)) || byKey(a.id, b.id))[0];
  const leaf = named.filter((p) => !family.childrenOf(p.id).length).sort((a, b) => ((b.by ?? 0) - (a.by ?? 0)) || byKey(a.id, b.id))[0];
  return [...new Set([undefined, eldest?.id, leaf?.id, family.byId.has('f') ? 'f' : undefined])];
}

/** Everything a plan must be, whatever the family. Returns the violations. */
function violations(p, family) {
  const out = [];
  const scope = family.people.map((x) => x.id);
  p.pages.forEach((pg, i) => {
    if (pg.pageNo !== i + 1) out.push(`page ${i + 1} is numbered ${pg.pageNo}`);
    if (!VARIANTS[pg.archetype]?.includes(pg.variant)) out.push(`page ${pg.pageNo}: ${pg.archetype}/${pg.variant} is not a known placement`);
    const prev = p.pages[i - 1];
    if (prev && prev.archetype === pg.archetype && prev.variant === pg.variant) out.push(`pages ${prev.pageNo} and ${pg.pageNo} are both ${pg.archetype}/${pg.variant}`);
    if (pg.people.length) {
      const cap = DENSITY_CAPS[pg.density];
      if (!cap || pg.people.length > cap[1]) out.push(`page ${pg.pageNo}: ${pg.people.length} people on a ${pg.density} page`);
    }
    if (pg.continued && pg.people.length < MIN_CONTINUATION) out.push(`page ${pg.pageNo} continues ${pg.chapter} with ${pg.people.length} entries`);
    if (pg.archetype === 'lane') {
      if (pg.groups.length > DENSITY.houses) out.push(`page ${pg.pageNo}: ${pg.groups.length} houses`);
      for (const h of pg.groups) if (h.people.length > DENSITY.house) out.push(`page ${pg.pageNo}: a house of ${h.people.length}`);
    }
    if (pg.archetype === 'register' && pg.people.length + pg.groups.length > DENSITY.register) out.push(`page ${pg.pageNo}: ${pg.people.length} rows and ${pg.groups.length} headings`);
    const grouped = pg.groups.flatMap((g) => g.people);
    if (pg.people.length && JSON.stringify(grouped) !== JSON.stringify(pg.people)) out.push(`page ${pg.pageNo}: its groups are not its people`);
  });
  if (storyPages(p).length > MAX_STORY_PAGES) out.push(`${storyPages(p).length} story pages`);
  // The register lists everyone in scope exactly once (the empty book has no register at all).
  const register = p.pages.filter((pg) => pg.archetype === 'register').flatMap((pg) => pg.people);
  if (p.featured !== null && JSON.stringify([...register].sort()) !== JSON.stringify([...scope].sort())) out.push('the register is not everyone in scope, once each');
  for (const id of p.registerOnly) if (p.pagesOf.has(id)) out.push(`${id} is register-only but on a story page`);
  for (const [id, pages] of p.pagesOf) for (const n of pages) if (!p.pages[n - 1].people.includes(id)) out.push(`${id} is not on page ${n}`);
  return out;
}

for (const name of Object.keys(BOOK_FIXTURES)) {
  test(`properties: ${name}, featuring several people`, async () => {
    const doc = await loadFixture(name);
    for (const featured of choices(doc)) {
      const { family, plan: p } = plan(doc, featured);
      assert.deepEqual(violations(p, family), [], `featuring ${featured ?? 'the most connected'}`);
      const [lo, hi] = pageBounds(2, family.people.length);
      assert.ok(p.pages.length >= lo && p.pages.length <= hi, `${p.pages.length} pages, outside ${lo}-${hi}`);
    }
  });
}

test('stability: the same family, planned twice or listed in another order, gets identical pages', async () => {
  for (const name of ['story-large', 'story-half-siblings', 'story-unknown-names']) {
    const doc = await loadFixture(name);
    const once = JSON.stringify(plan(doc, 'f').plan.pages);
    assert.equal(JSON.stringify(plan(doc, 'f').plan.pages), once, name);
    const reversed = { ...doc, people: [...doc.people].reverse(), relationships: [...(doc.relationships ?? [])].reverse() };
    assert.equal(JSON.stringify(plan(reversed, 'f').plan.pages), once, `${name}, reversed`);
  }
});

test('a plan is final: its pages cannot be changed after it is made', async () => {
  const { plan: p } = plan(await loadFixture('story-leaf'), 'f');
  assert.throws(() => { p.pages[2].pageNo = 99; }, TypeError);
  assert.throws(() => { p.pages[2].people.push('x'); }, TypeError);
  assert.throws(() => { p.pages.push({}); }, TypeError);
});

/* ------------------------------------------------------------------ split and merge */

test('splitBalanced: balanced runs, the larger last, so a continuation is never the smallest', () => {
  const ids = (n) => Array.from({ length: n }, (_, i) => i);
  const sizes = (n, cap) => splitBalanced(ids(n), cap).map((r) => r.length);
  assert.deepEqual(sizes(0, 8), []);
  assert.deepEqual(sizes(8, 8), [8]);
  assert.deepEqual(sizes(9, 8), [4, 5]);
  assert.deepEqual(sizes(10, 8), [5, 5]);   // overflowing by exactly 2: never an 8 and a 2
  assert.deepEqual(sizes(11, 8), [5, 6]);   // overflowing by exactly 3
  assert.deepEqual(sizes(5, 4), [2, 3]);
  assert.deepEqual(splitBalanced(ids(11), 8).flat(), ids(11), 'in order, nobody lost');
  for (const cap of [DENSITY.family, DENSITY.gathering, DENSITY.house, DENSITY.register]) {
    for (let n = cap + 1; n <= cap * 4; n++) {
      for (const run of splitBalanced(ids(n), cap).slice(1)) assert.ok(run.length >= MIN_CONTINUATION, `${n} over ${cap}`);
    }
  }
});

test('a chapter overflowing its page by exactly 2 or 3 continues on a page of at least 3', () => {
  // The siblings chapter holds F's siblings: a family page takes 8.
  for (const [n, expected] of [[DENSITY.family + 2, [5, 5]], [DENSITY.family + 3, [5, 6]]]) {
    const { plan: p } = plan(withSiblings(n), 'f');
    const sib = p.pages.filter((pg) => pg.chapter === 'siblings');
    assert.deepEqual(sib.map((pg) => pg.people.length), expected, `${n} siblings`);
    assert.deepEqual(sib.map((pg) => pg.continued), [false, true]);
  }
});

test('chapters of exactly 2 merge into one household page; a chapter of exactly 3 keeps its own', () => {
  // Parents (2) and siblings (2): both under 3, so they share a page.
  const two = plan(withSiblings(2), 'f').plan;
  assert.deepEqual(two.pages.filter((pg) => pg.chapters.includes('parents')).map((pg) => [pg.chapters, pg.copyKey, pg.people.length]), [[['parents', 'siblings'], 'parents', 4]]);
  // Parents (2) and siblings (3): the parents' page stands alone as a portrait hero.
  const three = plan(withSiblings(3), 'f').plan;
  assert.deepEqual(three.pages.filter((pg) => ['parents', 'siblings'].includes(pg.chapter)).map((pg) => `${pg.chapters.join('+')} ${pg.archetype} ${pg.people.length}`),
    ['parents portrait-hero 2', 'siblings gathering 3']);
});

/* ------------------------------------------------------------------ variety */

test('variety: a page takes the first placement that differs from the previous page\'s', () => {
  const { plan: p } = plan(withSiblings(DENSITY.family * 2 + 1), 'f');
  const sib = p.pages.filter((pg) => pg.chapter === 'siblings');
  assert.deepEqual(sib.map((pg) => pg.variant), ['band', 'doorways', 'band']);
  for (const [a, list] of Object.entries(VARIANTS)) assert.ok(list.length >= 2, `${a} needs a second placement`);
});

/* ------------------------------------------------------------------ the cap */

/** F, two parents, and `n` aunts and uncles on the father's side, each with a spouse and `kids` children. */
function lane(n, kids) {
  const people = [M('f', 'Ankit', '1995'), M('dad', 'Rajesh', '1960'), W('mum', 'Sunita', '1962'), M('gf', 'Shyam', '1930'), W('gm', 'Kamla', '1932')];
  const rels = [parents('dad', 'mum', 'f'), married('dad', 'mum'), married('gf', 'gm')];
  const aunts = [];
  for (let i = 0; i < n; i++) {
    const a = `a${String(i).padStart(3, '0')}`;
    aunts.push(a);
    people.push(M(a, `Uncle ${i}`, String(1940 + (i % 30))), W(`${a}w`, `Aunt ${i}`, '1945'));
    rels.push(married(a, `${a}w`));
    const children = Array.from({ length: kids }, (_, k) => `${a}c${k}`);
    for (const c of children) people.push(M(c, `Cousin ${c}`, '1975'));
    rels.push(parents(a, `${a}w`, ...children));
  }
  rels.push(parents('gf', 'gm', 'dad', ...aunts));
  return tree(people, rels);
}

test('the cap: a very large family keeps to 28 story pages, and everyone beyond is in the register', () => {
  const doc = lane(90, 6);   // 90 houses of 8: far more lane than 28 pages hold
  const { family, plan: p } = plan(doc, 'f');
  assert.ok(family.people.length > 700);
  assert.equal(storyPages(p).length, MAX_STORY_PAGES);
  assert.ok(p.registerOnly.length > 0, 'someone overflowed into the register');
  assert.deepEqual(violations(p, family), []);
  // Nobody is dropped: the register-only people are exactly those on no story page.
  const onStory = new Set(storyPages(p).flatMap((pg) => pg.people));
  assert.deepEqual(family.people.map((x) => x.id).filter((id) => !onStory.has(id)).sort(), [...p.registerOnly].sort());
  // The pages the cap cut are the lane's, the last in line for an extra page.
  assert.ok(p.pages.some((pg) => pg.chapter === 'parents') && p.pages.some((pg) => pg.chapter === 'courtyards'));
});

test('the cap holds on the large fixture, and a tighter one trims the lane first', async () => {
  const doc = await loadFixture('story-large');
  const { family, plan: p } = plan(doc, 'f');
  assert.ok(storyPages(p).length <= MAX_STORY_PAGES);
  const tight = plan(doc, 'f', { maxStoryPages: 13 }).plan;
  assert.equal(storyPages(tight).length, 13, 'thirteen chapters, one page each');
  assert.deepEqual(violations(tight, family).filter((v) => !/story pages/.test(v)), []);
  assert.equal(tight.pages.filter((pg) => pg.chapter === 'lane').length, 1, 'the lane keeps only its first page');
  assert.equal(tight.pages.filter((pg) => pg.archetype === 'register').length, p.pages.filter((pg) => pg.archetype === 'register').length, 'the register is never cut');
  assert.ok(tight.registerOnly.length > p.registerOnly.length);
});

/* ------------------------------------------------------------------ family shape */

test('eldest F: no roots, courtyards or parents; the opening folds them in; the story flows downward', async () => {
  const { plan: p } = plan(await loadFixture('story-eldest'), 'f');
  assert.ok(p.shape.eldest);
  for (const c of ['roots', 'courtyards', 'parents']) assert.ok(!p.pages.some((pg) => pg.chapters.includes(c)), c);
  assert.deepEqual(p.pages[1].folds, ['roots', 'courtyards']);
  // Spouses and children come before siblings when nobody is above F.
  const doc = tree([M('f', 'Ankit', '1950'), W('w', 'Meera', '1952'), M('b1', 'Brother 1', '1953'), M('b2', 'Brother 2', '1954'), M('b3', 'Brother 3', '1955'),
    M('c1', 'Child 1', '1975'), M('c2', 'Child 2', '1977'), M('c3', 'Child 3', '1979')],
  [married('f', 'w'), parents('f', 'w', 'c1', 'c2', 'c3'), ['b1', 'b2', 'b3'].map((b) => ({ type: 'SIBLING', from: 'f', to: b }))]);
  const order = plan(doc, 'f').plan.pages.map((pg) => pg.chapter).filter((c) => ['siblings', 'spouses', 'children'].includes(c));
  assert.deepEqual(order, ['spouses', 'children', 'siblings']);
});

test('child F: the spouse and children chapters are skipped', async () => {
  const { plan: p } = plan(await loadFixture('story-leaf'), 'f');
  assert.ok(p.shape.child);
  for (const c of ['spouses', 'children']) assert.ok(!p.pages.some((pg) => pg.chapters.includes(c)), c);
  assert.ok(p.pages.some((pg) => pg.chapter === 'parents'));
});

test('tiny families collapse to 5-7 pages, with no numbers page', async () => {
  for (const name of ['story-tiny', 'story-notes', 'story-unlinked']) {
    const doc = await loadFixture(name);
    const { family, plan: p } = plan(doc, 'f');
    assert.ok(family.people.length <= TINY && p.shape.tiny, name);
    assert.ok(p.pages.length >= 5 && p.pages.length <= 7, `${name}: ${p.pages.length} pages`);
    assert.ok(!p.pages.some((pg) => pg.chapter === 'numbers'), name);
  }
});

test('a family of about 200 takes 22-28 pages', async () => {
  const { family, plan: p } = plan(await loadFixture('story-large'), 'f');
  assert.equal(family.people.length, 200);
  assert.ok(p.pages.length >= 22 && p.pages.length <= 28, `${p.pages.length} pages`);
});

test('an empty tree is a cover, a page waiting for its family, and the closing', async () => {
  const { plan: p } = plan(await loadFixture('story-empty'));
  assert.ok(p.shape.empty);
  assert.deepEqual(p.pages.map((pg) => `${pg.pageNo} ${pg.archetype}`), ['1 cover', '2 waiting', '3 closing']);
});

/* ------------------------------------------------------------------ the composer */

test('compose.js routes a format-2 template through the planner, then refuses to draw it by name', async () => {
  const doc = await loadFixture('story-large');
  assert.throws(() => composeBook(doc, { now: NOW, featured: 'f' }, TEMPLATE),
    /"diwali-story" is a format-2 storybook template: its 25 pages are planned, but their archetypes are not built yet/);
  // The planner, not a blanket refusal, is what runs: a chapter it does not know fails there.
  assert.throws(() => composeBook(doc, { now: NOW }, storyTemplate([...CHAPTERS, 'fireworks'])), /does not know the chapter "fireworks"/);
});
