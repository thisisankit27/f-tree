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
} from './copy.js';
import { kinOf } from './kin.js';
import { resolveFeatured } from './featured.js';
import { readFamily } from '../family.js';
import { BOOK_FIXTURES, NOW, loadFixture } from '../qa/book-fixtures.mjs';

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

/* ------------------------------------------------------------------ property test: every fixture, both languages */

const STORY_FIXTURES = Object.keys(BOOK_FIXTURES).filter((n) => n.startsWith('story-'));

test('every composer degrades gracefully and shows no living person an age, across every story fixture', async () => {
  assert.ok(STORY_FIXTURES.length > 0, 'no story-*.json fixtures found');
  for (const name of STORY_FIXTURES) {
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
