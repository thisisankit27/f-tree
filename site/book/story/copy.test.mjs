/*
 * story/copy.js: sentences, fallbacks and kin captions (#252).
 *
 * Small synthetic families, built the same way kin.test.mjs builds them, so each test can assert
 * an exact composed string rather than a shape. The property test at the bottom runs every
 * composer over every `story-*.json` fixture (#245) and over both `words` settings, proving the
 * degrade-gracefully rule (no stray placeholder, no "undefined") and the no-living-age rule hold
 * everywhere, not just on the cases picked by hand above it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fillPlaceholders, renderCopy, nameOf, possessive, kinCaption, noteCaption,
  countInCircle, numberFact, openingLine, rootsLine, stillToBeFoundCaption,
  chapterVars, chapterCopy,
} from './copy.js';
import { kinOf } from './kin.js';
import { resolveFeatured } from './featured.js';
import { CHAPTERS } from './plan.js';
import { readFamily } from '../family.js';
import { validateTemplate, REQUIRED_CHAPTERS, PAPERCUT_PALETTE_KEYS, HAND_FONT_KEY } from '../template.js';
import { BOOK_FIXTURES, TEMPLATES, NOW, loadFixture } from '../qa/book-fixtures.mjs';

const YEAR = Number(NOW.slice(0, 4));

/* ------------------------------------------------------------------ building families */

const M = (id, name, birthDate, extra = {}) => ({ id, name, gender: 'MALE', birthDate, ...extra });
const W = (id, name, birthDate, extra = {}) => ({ id, name, gender: 'FEMALE', birthDate, ...extra });
const parent = (from, ...children) => children.map((to) => ({ type: 'PARENT', from, to }));
const parents = (a, b, ...children) => [...parent(a, ...children), ...parent(b, ...children)];
const married = (a, b, subtype = 'MARRIED') => ({ type: 'SPOUSE', from: a, to: b, subtype });
const doc = (people, relationships) => ({
  format: 'f-tree', version: 1, people,
  relationships: relationships.flat().map((r, i) => ({ id: `r${i}`, ...r })),
});

/** `readFamily` + `kinOf`, in one call, the way a page archetype would build them. */
function build(document, featuredId, options = { words: 'en' }) {
  const family = readFamily(document, { now: NOW, ...options });
  const kin = kinOf(family, featuredId, options);
  return { family, kin };
}

/* ------------------------------------------------------------------ fillPlaceholders / renderCopy */

test('fillPlaceholders fills every known token and leaves plain text alone', () => {
  assert.equal(fillPlaceholders('{featured} was born in {year}.', { featured: 'Ankit', year: 1995 }),
    'Ankit was born in 1995.');
  assert.equal(fillPlaceholders('Happy Diwali!'), 'Happy Diwali!');
});

test('fillPlaceholders drops a missing fact rather than printing {placeholder} or "undefined"', () => {
  const out = fillPlaceholders('{featured} was born in {year}, of {family}.', { featured: 'Ankit' });
  assert.ok(!out.includes('{'), out);
  assert.ok(!out.includes('}'), out);
  assert.ok(!/undefined/.test(out), out);
  assert.equal(out, 'Ankit was born in, of.');
});

test('renderCopy picks the plural line and fills it, or returns null for no copy at all', () => {
  const entry = { title: 'Our lane', line: { one: '{featured} has one cousin.', other: '{featured} has {n} cousins.' } };
  assert.deepEqual(renderCopy(entry, { featured: 'Ankit', n: 1 }), { title: 'Our lane', line: 'Ankit has one cousin.' });
  assert.deepEqual(renderCopy(entry, { featured: 'Ankit', n: 5 }), { title: 'Our lane', line: 'Ankit has 5 cousins.' });
  assert.equal(renderCopy(undefined, {}), null);
});

/* ------------------------------------------------------------------ nameOf / possessive */

test('nameOf gives a nameless person\'s named relative, never "Unknown"', () => {
  const family = doc([M('gf', 'Shyam Lal', '1920'), W('gm', null, '1925')], [married('gf', 'gm')]);
  const { family: f, kin: k } = build(family, 'gf');
  assert.equal(nameOf(f, k, 'gf'), 'Shyam Lal');
  assert.equal(nameOf(f, k, 'gm'), 'Shyam Lal’s wife');
});

test('nameOf is null for somebody with no name and no named neighbour', () => {
  const family = doc([W('gm', null, '1925'), M('stranger', 'Nobody', '1980')], []);
  const { family: f, kin: k } = build(family, 'gm');
  assert.equal(nameOf(f, k, 'gm'), null);
});

test('possessive is the one apostrophe form this file prints', () => {
  assert.equal(possessive('Ankit'), 'Ankit’s');
});

/* ------------------------------------------------------------------ kinCaption */

const BIG = doc([
  M('gf', 'Shyam Lal', '1920'), W('mgm', 'Kavita', '1930'),
  M('dad', 'Rajesh', '1950'), W('mum', 'Sunita', '1955'),
  M('tau', 'Mahesh', '1945'), M('cousin', 'Vikas', '1970'), W('cousinwife', 'Neha', '1972'),
  M('ankit', 'Ankit', '1995'), W('priya', 'Priya', '1998'),
  W('wife', 'Meera', '1996'), W('ex', 'Simran', '1994'),
], [
  parent('gf', 'dad', 'tau'),               // dad and tau: full brothers, both gf's sons
  parent('mgm', 'mum'),                     // mum's mother: Ankit's one recorded grandparent
  parents('dad', 'mum', 'ankit', 'priya'),
  parent('tau', 'cousin'), married('cousin', 'cousinwife'),
  married('ankit', 'wife'),
  married('ankit', 'ex', 'DIVORCED'),
]);

test('kinCaption resolves the English word by default', () => {
  const { family, kin } = build(BIG, 'ankit', { words: 'en' });
  assert.equal(kinCaption(kin, family, 'dad'), 'father');
  assert.equal(kinCaption(kin, family, 'cousin'), 'first cousin');
});

test('kinCaption resolves Hindi when options.words is "hi" and the vocabulary has a word', () => {
  const { family, kin } = build(BIG, 'ankit', { words: 'hi' });
  // Parents are पिताजी / माँ, the approved book wording (storybook-plan.md), not the vocabulary's default.
  assert.equal(kinCaption(kin, family, 'dad'), 'पिताजी');
  assert.equal(kinCaption(kin, family, 'mum'), 'माँ');
  // A grandparent's word comes from the reviewed vocabulary itself (kinship-hi.js: MGM -> नानी).
  assert.equal(kinCaption(kin, family, 'mgm'), 'नानी');
});

test('kinCaption falls back to English where Hindi has no word for the relation - the app\'s own fallback', () => {
  const { family, kin } = build(BIG, 'ankit', { words: 'hi' });
  // A former spouse gets no Hindi word (kin.js: "पत्नी/पति would state a marriage that ended").
  assert.equal(kinCaption(kin, family, 'ex'), 'former wife');
});

test('kinCaption phrases a marriage-through relation the way the desktop\'s sentenceFor does', () => {
  const { family, kin } = build(BIG, 'ankit', { words: 'en' });
  const w = kin.words('cousinwife');
  assert.equal(w.en, null, 'a first cousin\'s wife has no single English word - precondition for this test');
  assert.equal(w.through?.kind, 'married-to');
  assert.equal(kinCaption(kin, family, 'cousinwife'), 'married to Ankit’s first cousin');
});

test('kinCaption phrases an of-spouse relation the same way, never a possessive chain', () => {
  const family = doc([
    M('ggm', 'Asha', '1900'), W('mgm', 'Kavita', '1930'), W('wife', 'Meera', '1996'), M('ankit', 'Ankit', '1995'),
  ], [parent('ggm', 'mgm'), parent('mgm', 'wife'), married('ankit', 'wife')]);
  const { family: f, kin: k } = build(family, 'ankit', { words: 'en' });
  const w = k.words('ggm');
  assert.equal(w.en, null, 'a wife\'s grandmother has no single in-law word - precondition for this test');
  assert.equal(w.through?.kind, 'of-spouse');
  const caption = kinCaption(k, f, 'ggm');
  assert.ok(caption.startsWith('the '), caption);
  assert.ok(caption.endsWith('of Ankit’s wife'), caption);
  assert.ok(!/wife’s|wife's/.test(caption), `a possessive chain leaked through: ${caption}`);
});

test('kinCaption is null for the featured person and for anyone not joined to them', () => {
  const family = doc([M('ankit', 'Ankit', '1995'), M('stranger', 'Nobody', '1980')], []);
  const { family: f, kin: k } = build(family, 'ankit');
  assert.equal(kinCaption(k, f, 'ankit'), null);
  assert.equal(kinCaption(k, f, 'stranger'), null);
});

/* ------------------------------------------------------------------ note captions */

test('noteCaption shows the clamped note on a story page only when options.notes is on', () => {
  const family = doc([M('ankit', 'Ankit', '1995', { notes: 'A line about Ankit.' })], []);
  const withNotes = readFamily(family, { now: NOW, notes: true });
  const without = readFamily(family, { now: NOW });
  assert.equal(noteCaption('opening', withNotes, 'ankit', { notes: true }), 'A line about Ankit.');
  assert.equal(noteCaption('opening', without, 'ankit', { notes: false }), null);
  assert.equal(noteCaption('opening', withNotes, 'ankit', { notes: false }), null);
});

test('noteCaption never fires on the register, even with notes switched on', () => {
  const family = doc([M('ankit', 'Ankit', '1995', { notes: 'A line about Ankit.' })], []);
  const withNotes = readFamily(family, { now: NOW, notes: true });
  assert.equal(noteCaption('register', withNotes, 'ankit', { notes: true }), null);
});

/* ------------------------------------------------------------------ numeric facts */

test('numberFact and countInCircle read kin.js\'s own circle counts, never a second count', () => {
  const { family, kin } = build(BIG, 'ankit', { words: 'en' });
  const cousins = countInCircle(kin, 'branches', 'cousin');
  assert.equal(cousins, kin.circles.branches.filter((id) => kin.people.get(id).role === 'cousin').length);
  assert.equal(cousins, 1);
  assert.equal(numberFact(family, kin, cousins, 'cousin'), 'Ankit has one cousin.');
  assert.equal(numberFact(family, kin, 3, 'cousin'), 'Ankit has three cousins.');
  assert.equal(numberFact(family, kin, 0, 'cousin'), null, 'a zero count is not a fact worth a sentence');
});

/* ------------------------------------------------------------------ openingLine */

test('openingLine composes the full sentence from a complete record', () => {
  const family = doc([
    M('dad', 'Rajesh', '1950'), W('mum', 'Sunita', '1955'),
    M('ankit', 'Ankit', '1995'), W('priya', 'Priya', '1990'), M('rahul', 'Rahul', '2000'),
  ], [parents('dad', 'mum', 'ankit', 'priya', 'rahul')]);
  const { family: f, kin: k } = build(family, 'ankit');
  assert.equal(openingLine(f, k),
    'Ankit was born in 1995, the second of three children of Rajesh and Sunita. This is the family behind Ankit.');
});

test('openingLine drops the birth-order claim, not the sentence, when the featured person\'s year is unknown', () => {
  const family = doc([
    M('dad', 'Rajesh', '1950'), W('mum', 'Sunita', '1955'), M('ankit', 'Ankit', null), W('priya', 'Priya', '1990'),
  ], [parents('dad', 'mum', 'ankit', 'priya')]);
  const { family: f, kin: k } = build(family, 'ankit');
  const out = openingLine(f, k);
  assert.ok(!/undefined|NaN|\{/.test(out), out);
  // No year to rank Ankit by, so the record still names his parents without calling him "the
  // eldest" of anything it cannot actually place him within.
  assert.equal(out, 'Ankit is a child of Rajesh and Sunita. This is the family behind Ankit.');
});

test('openingLine drops the parents clause entirely when none is recorded, and keeps the year', () => {
  const family = doc([M('ankit', 'Ankit', '1995')], []);
  const { family: f, kin: k } = build(family, 'ankit');
  const out = openingLine(f, k);
  assert.ok(!/undefined|NaN|\{/.test(out), out);
  assert.equal(out, 'Ankit was born in 1995. This is the family behind Ankit.');
});

test('openingLine names the featured person by relation when their own name is lost', () => {
  const family = doc([M('gf', 'Shyam Lal', '1920'), W('gm', null, '1925')], [married('gf', 'gm')]);
  const { family: f, kin: k } = build(family, 'gm');
  const out = openingLine(f, k);
  assert.ok(out.startsWith('Shyam Lal’s wife'), out);
  assert.ok(out.endsWith('This is the family behind Shyam Lal’s wife.'), out);
});

/* ------------------------------------------------------------------ rootsLine */

test('rootsLine counts generations from kin.js\'s own gen field, never a walk of its own', () => {
  const family = doc([
    M('ggf', 'Ram Prasad', '1890'), M('gf', 'Shyam Lal', '1920'), M('dad', 'Rajesh', '1950'), M('ankit', 'Ankit', '1995'),
  ], [parent('ggf', 'gf'), parent('gf', 'dad'), parent('dad', 'ankit')]);
  const { family: f, kin: k } = build(family, 'ankit');
  assert.equal(rootsLine(f, k), 'Three generations before Ankit');
});

test('rootsLine is null when nobody is known further back than the featured person', () => {
  const family = doc([M('ankit', 'Ankit', '1995')], []);
  const { family: f, kin: k } = build(family, 'ankit');
  assert.equal(rootsLine(f, k), null);
});

/* ------------------------------------------------------------------ stillToBeFoundCaption */

test('stillToBeFoundCaption places a nameless, unlinked-by-name relative by term and side', () => {
  // ggf's only neighbour is mid, and mid has no name either - so unlike a person directly next to
  // somebody named, ggf gets no namedBy fallback (kin.js's namedBy only looks one link out) and
  // is genuinely "still to be found": placed by term and side instead.
  const family = doc([
    M('gf', 'Shyam Lal', '1920'), M('mid', null, '1895'), M('ggf', null, '1870'),
  ], [parent('mid', 'gf'), parent('ggf', 'mid')]);
  const { family: f, kin: k } = build(family, 'gf');
  assert.equal(nameOf(f, k, 'ggf'), null, 'precondition: ggf has no name and no namedBy fallback');
  const caption = stillToBeFoundCaption(f, k, 'ggf');
  assert.ok(caption.startsWith('Shyam Lal’s '), caption);
  assert.ok(caption.endsWith(', on the paternal side'), caption);
  // mid has a named neighbour (gf), so he is captioned by nameOf elsewhere, not this function.
  assert.equal(stillToBeFoundCaption(f, k, 'mid'), null);
});

/* ------------------------------------------------------------------ late-review regressions */

test('the birth-order fragment gives correct English ordinal suffixes past the word list (21st, not 21th)', () => {
  const older = Array.from({ length: 20 }, (_, i) => M(`o${i}`, `Older ${i}`, String(1970 + i)));
  const younger = [M('y0', 'Younger 0', '1991'), M('y1', 'Younger 1', '1992')];
  const people = [M('dad', 'Rajesh', '1950'), W('mum', 'Sunita', '1955'), M('ankit', 'Ankit', '1990'), ...older, ...younger];
  const family = doc(people, [parents('dad', 'mum', 'ankit', ...older.map((p) => p.id), ...younger.map((p) => p.id))]);
  const { family: f, kin: k } = build(family, 'ankit');
  const out = openingLine(f, k);
  assert.ok(/\b21st\b/.test(out), out);
  assert.ok(!/21th/.test(out), out);
});

test('the birth-order fragment is dropped, not guessed, when any full sibling\'s birth year is unknown', () => {
  const family = doc([
    M('dad', 'Rajesh', '1950'), W('mum', 'Sunita', '1955'),
    M('ankit', 'Ankit', '1995'), W('priya', 'Priya', null), M('rahul', 'Rahul', '1990'),
  ], [parents('dad', 'mum', 'ankit', 'priya', 'rahul')]);
  const { family: f, kin: k } = build(family, 'ankit');
  const out = openingLine(f, k);
  // Priya's year is unknown, so Ankit cannot honestly be called "the eldest", "the youngest" or
  // any ordinal among the three - even though Ankit's own year (1995) is known.
  assert.ok(!/eldest|youngest|second|third/.test(out), out);
  assert.equal(out, 'Ankit was born in 1995, a child of Rajesh and Sunita. This is the family behind Ankit.');
});

test('fillPlaceholders is idempotent: three or more dropped facts in a row still clean up fully', () => {
  assert.equal(fillPlaceholders('{a}, {b}, {c}, {d}.', { a: 'Ankit' }), 'Ankit.');
});

test('fillPlaceholders drops a whole labelled parenthetical when its one placeholder is empty', () => {
  assert.equal(fillPlaceholders('{featured} (born {year}).', { featured: 'Ankit' }), 'Ankit.');
  assert.equal(fillPlaceholders('{featured} (born {year}).', { featured: 'Ankit', year: 1995 }), 'Ankit (born 1995).');
  assert.equal(fillPlaceholders('{featured} ({featured-first}) is here.', { featured: 'Ankit' }), 'Ankit is here.');
});

test('numberFact takes an explicit {one, many} pair for a noun a naive "s" would get wrong', () => {
  const { family, kin } = build(doc([M('ankit', 'Ankit', '1995')], []), 'ankit');
  assert.equal(numberFact(family, kin, 1, { one: 'child', many: 'children' }), 'Ankit has one child.');
  const many = numberFact(family, kin, 2, { one: 'child', many: 'children' });
  assert.equal(many, 'Ankit has two children.');
  assert.ok(!many.includes('childs'), many);
});

/* ------------------------------------------------------------------ chapterCopy: every chapter id */

/** A format-2 template with real (placeholder-heavy) copy for every chapter id `plan.js` knows. */
function comprehensiveTemplate() {
  const copy = Object.fromEntries(CHAPTERS.map((id) => [id, {
    title: `${id} - {family}`,
    line: {
      one: '{featured} ({featured-first}) of {family} (born {year}), one to know.',
      other: '{featured} ({featured-first}) of {family} (born {year}), {n} to know.',
    },
  }]));
  return validateTemplate({
    format: 2, id: 'copy-table-test', name: 'Copy table test', fileSuffix: 'Book', art: 'papercut',
    fonts: { display: 'book_display', text: 'book_text', strong: 'book_strong', hand: HAND_FONT_KEY },
    palette: Object.fromEntries(PAPERCUT_PALETTE_KEYS.map((k) => [k, '#112233'])),
    cover: { greeting: 'Hi', subtitle: 'from {family}', line: 'one lamp' },
    story: { chapters: [...CHAPTERS] },
    copy,
  });
}

test('chapterCopy composes for every chapter id in plan.js\'s CHAPTERS, and degrades gracefully across an incomplete record', () => {
  assert.deepEqual([...REQUIRED_CHAPTERS].sort(), [...REQUIRED_CHAPTERS].sort().filter((c) => CHAPTERS.includes(c)),
    'precondition: every required chapter is one CHAPTERS lists');
  const template = comprehensiveTemplate();
  const complete = () => doc([M('dad', 'Rajesh', '1950'), W('mum', 'Sunita', '1955'), M('ankit', 'Ankit', '1995'), W('priya', 'Priya', '1998')],
    [parents('dad', 'mum', 'ankit', 'priya')]);
  const scenarios = {
    complete: [complete(), {}],
    'missing year': [(() => { const d = complete(); d.people.find((p) => p.id === 'ankit').birthDate = null; return d; })(), {}],
    'missing gender': [(() => { const d = complete(); d.people.find((p) => p.id === 'ankit').gender = null; return d; })(), {}],
    'missing name': [doc([M('ankit', null, '1995')], []), { featured: 'ankit' }],
  };
  for (const [label, [document, options]] of Object.entries(scenarios)) {
    const family = readFamily(document, { now: NOW });
    const featuredId = resolveFeatured(family, options);
    const kin = kinOf(family, featuredId, {});
    for (const chapterId of CHAPTERS) {
      const rendered = chapterCopy(chapterId, { family, kin, tpl: template });
      assert.ok(rendered, `${label}/${chapterId}: the template has copy for every chapter`);
      for (const [part, text] of Object.entries(rendered)) {
        assert.ok(!/[{}]/.test(text), `${label}/${chapterId}/${part}: stray placeholder in "${text}"`);
        assert.ok(!/\b(?:undefined|null|NaN)\b/i.test(text), `${label}/${chapterId}/${part}: "${text}"`);
        assert.ok(!/ {2,}/.test(text), `${label}/${chapterId}/${part}: doubled space in "${text}"`);
        assert.ok(!/[,.;:!?]{2,}/.test(text), `${label}/${chapterId}/${part}: doubled punctuation in "${text}"`);
      }
    }
  }
});

test('chapterCopy also composes over every format-2 template already in the catalogue', () => {
  const format2 = Object.values(TEMPLATES).filter((t) => t.format === 2);
  // None ship in the catalogue yet - #259 adds diwali-story - so chapterVars/chapterCopy
  // themselves are what carry this test's weight until then (the table test above); this one
  // exists so the day a real format-2 template lands, it is swept automatically, not silently.
  const family = readFamily(doc([M('ankit', 'Ankit', '1995')], []), { now: NOW });
  const kin = kinOf(family, resolveFeatured(family, {}), {});
  for (const tpl of format2) {
    for (const chapterId of tpl.story.chapters) {
      const rendered = chapterCopy(chapterId, { family, kin, tpl });
      if (!rendered) continue;
      for (const text of [rendered.title, rendered.line]) {
        assert.ok(!/[{}]/.test(text), `${tpl.id}/${chapterId}: "${text}"`);
        assert.ok(!/\b(?:undefined|null|NaN)\b/i.test(text), `${tpl.id}/${chapterId}: "${text}"`);
      }
    }
  }
});

/* ------------------------------------------------------------------ property test: every fixture, both languages */

// #245's whole fixture set (`site/book/qa/book-fixtures.mjs`), not just the storybook's own
// story-*.json ones - a composer has no reason to behave differently on `sample`, `large` or
// `remarriage`, and restricting the sweep to story-* would miss it if it did.
const ALL_FIXTURES = Object.keys(BOOK_FIXTURES);

test('every composer degrades gracefully and shows no living person an age, across every fixture in the suite', async () => {
  assert.ok(ALL_FIXTURES.length > 0, 'no book fixtures found');
  for (const name of ALL_FIXTURES) {
    const document = await loadFixture(name);
    for (const words of ['en', 'hi']) {
      const family = readFamily(document, { now: NOW, words, notes: true });
      const featuredId = resolveFeatured(family, {});
      const kin = kinOf(family, featuredId, { words });
      if (kin.featured === null) continue;   // nobody nameable to feature: nothing to compose

      const strings = [];
      strings.push(openingLine(family, kin));
      strings.push(rootsLine(family, kin));
      for (const circle of Object.keys(kin.circles)) {
        for (const id of kin.circles[circle]) {
          strings.push(kinCaption(kin, family, id));
          strings.push(stillToBeFoundCaption(family, kin, id));
          strings.push(noteCaption('opening', family, id, { notes: true }));
        }
      }
      const text = strings.filter((s) => typeof s === 'string').join(' \n ');

      assert.ok(!/\{[^{}]*\}/.test(text), `${name}/${words}: a stray placeholder leaked through: ${text}`);
      assert.ok(!/undefined|NaN/.test(text), `${name}/${words}: ${text}`);

      // No living person's recorded age (or the one either side of it, for an unknown birth month)
      // may appear next to "year(s)".
      for (const p of family.people) {
        if (p.deceased || p.by === null) continue;
        for (const n of [YEAR - p.by, YEAR - p.by - 1]) {
          if (n < 0) continue;
          const re = new RegExp(`\\b${n}\\s*(?:years?|yrs?)\\b`, 'i');
          assert.ok(!re.test(text), `${name}/${words}: ${p.name ?? p.id} may be given an age (${n}) in: ${text}`);
        }
      }
    }
  }
});
