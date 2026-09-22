/*
 * The book's copy layer (#252): the actual words a story page prints, filled from `kin.js`'s
 * circles and the catalogue's own `copy` placeholders, never a template with visible blanks.
 *
 * Everything here is a pure function of `family` (family.js's `readFamily`), `kin`
 * (`kinOf(family, featuredId, options)`) and, for a template-driven line, the validated `copy`
 * entry (`template.js`'s format-2 schema). Nothing is placed on a page - that is the page
 * archetypes' job (#256-258) - and nothing here calls `relate()` a second time or recomputes a
 * count `kin.js` already has: a fact that disagreed between this file and the circle it describes
 * would be worse than one left out.
 *
 * ## Fallbacks, not broken sentences
 *
 * A missing fact never leaves a literal `{placeholder}` or the word "undefined" on a page
 * (`fillPlaceholders`), and the sentence composers below go further: a missing birth year drops
 * the year clause rather than printing an empty one, and a person with no recorded gender never
 * needs a fallback at all, because nothing here reaches for a pronoun - `kin.js`'s own words
 * (`parentLabel`, `spouseLabel`, `childLabel`, `siblingLabel`, all in `model.js`) already carry the
 * gender-neutral terms ("parent", "spouse", "sibling") the app uses everywhere else, so a missing
 * gender is already handled before it reaches this file.
 *
 * ## Kin captions and "through"
 *
 * `kin.js`'s `words(id).word` is already the caption for anyone one recognisable relation from the
 * featured person: the reviewed Hindi word, or the English one where `options.words` isn't `'hi'`
 * or Hindi has none - the same fallback the rest of the app uses, not a new one. `kinCaption` only
 * adds the one case `words()` cannot hand back as a single word: a relation that runs through one
 * marriage (`through`), phrased the way the desktop's `sentenceFor` does
 * (`desktop/renderer/relation.js`) - "married to Ankit's cousin", never "Ankit's cousin's wife".
 */

import { PLACEHOLDER } from '../template.js';
import { andList, countWords, ORDINALS } from '../blocks/words.js';
import { byKey } from '../family.js';

/* ------------------------------------------------------------------ template placeholders */

/**
 * Fills `str`'s `{placeholder}` tokens from `vars` (keyed by the same names `template.js`
 * validates a template's copy against: `featured`, `featured-first`, `family`, `n`, `year`).
 * A token with no value in `vars` is removed, never left as `{placeholder}` or printed as
 * "undefined" - and the punctuation either side of a removed token is tidied, so a dropped fact
 * never leaves a comma stranded in front of a full stop.
 */
export function fillPlaceholders(str, vars = {}) {
  if (typeof str !== 'string') return str;
  const filled = str.replace(PLACEHOLDER, (_, name) => {
    const v = vars[name];
    return v === null || v === undefined ? '' : String(v);
  });
  return filled
    .replace(/\s+([,.;:!?])/g, '$1')   // "Ankit ," -> "Ankit,"
    .replace(/,\s*,/g, ',')            // two facts, one of them dropped
    .replace(/,\s*\./g, '.')           // a dropped fact was the sentence's last clause
    .replace(/\(\s*\)/g, '')           // an empty parenthetical
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** `line.one` for exactly one, `line.other` otherwise - `template.js`'s own `{one, other}` shape. */
export function pickLine(line, n) {
  if (!line) return null;
  return n === 1 ? line.one : line.other;
}

/**
 * A template's `copy[chapter]` (`{title, line: {one, other}}`), filled from `vars`. Returns
 * `null` where the template names no copy for this chapter - a page archetype falls back to its
 * own composed sentence in that case, never a blank.
 */
export function renderCopy(entry, vars = {}) {
  if (!entry) return null;
  return { title: fillPlaceholders(entry.title, vars), line: fillPlaceholders(pickLine(entry.line, vars.n), vars) };
}

/* ------------------------------------------------------------------ names */

/** `${name}’s` - the one possessive form this file ever prints, so every caller reads the same. */
export const possessive = (name) => `${name}’s`;

/**
 * The name a page prints for `id`: their own, or - belief 3, storybook-plan.md - the relative
 * they are named through ("Shyam Lal's wife"), never "Unknown". `kin.js` computes `namedBy` for
 * exactly this; this only ever reads it, and only recurses because a namedBy candidate is always
 * somebody with a name of their own (`kin.js`'s own rule), so it can never loop.
 */
export function nameOf(family, kin, id) {
  const p = family.byId.get(id);
  if (p?.name) return p.name;
  const namedBy = kin.people.get(id)?.namedBy;
  if (!namedBy) return null;
  const via = nameOf(family, kin, namedBy.id);
  return via ? `${possessive(via)} ${namedBy.word}` : null;
}

/* ------------------------------------------------------------------ kin captions */

/**
 * The featured person's `id`'s term, phrased the way the desktop's `sentenceFor` phrases a
 * marriage relation - turned round rather than chained ("married to Ankit's cousin", never
 * "Ankit's cousin's wife"; "the mother of Ankit's wife", never "Ankit's wife's mother").
 */
function throughPhrase(kin, featuredName, through) {
  if (through.kind === 'married-to') return `married to ${possessive(featuredName)} ${through.term}`;
  const spouseWord = kin.words(through.id)?.word ?? 'spouse';
  return `the ${through.term} of ${possessive(featuredName)} ${spouseWord}`;
}

/**
 * The caption a family-chapter frame prints under `id`'s portrait, in the hand type role: the kin
 * word `kin.js` already resolved (Hindi when `options.words==='hi'` and the vocabulary has one,
 * English otherwise - `words(id).word` already is that fallback), or, where the relation runs
 * through one marriage, the phrase above. `null` for the featured person themselves and for
 * anyone `kin.js` could not join to them at all - neither is captioned.
 */
export function kinCaption(kin, family, id) {
  const w = kin.words(id);
  if (!w) return null;
  if (w.word) return w.word;
  if (w.through) {
    const featuredName = nameOf(family, kin, kin.featured);
    if (featuredName) return throughPhrase(kin, featuredName, w.through);
  }
  return null;
}

/* ------------------------------------------------------------------ notes */

/**
 * The handwritten caption beside `id`'s portrait, or `null`. Notes are opt-in (`options.notes`,
 * off by default) and story-page-only: the register lists everyone by name alone
 * (storybook-plan.md, "Notes"), so `chapterId === 'register'` always returns `null` here rather
 * than trusting every future archetype to remember not to ask. `family.js`'s `readFamily` has
 * already clamped and stripped the note; this never re-reads `person.notes`.
 */
export function noteCaption(chapterId, family, id, options = {}) {
  if (!options.notes || chapterId === 'register') return null;
  return family.byId.get(id)?.note ?? null;
}

/* ------------------------------------------------------------------ numeric facts */

/** How many of `circle` carry `role` (or the whole circle, with no `role` given) - never a second count. */
export function countInCircle(kin, circle, role = null) {
  const ids = kin.circles[circle] ?? [];
  return role ? ids.filter((id) => kin.people.get(id).role === role).length : ids.length;
}

/** "Ankit has 23 cousins.", or `null` when there is nothing to say - a zero-count fact is not a fact. */
export function numberFact(family, kin, n, noun) {
  if (!n) return null;
  const featuredName = nameOf(family, kin, kin.featured);
  if (!featuredName) return null;
  return `${featuredName} has ${countWords(n)} ${n === 1 ? noun : `${noun}s`}.`;
}

/* ------------------------------------------------------------------ sentence composition */

/**
 * The birth-order fragment of the opening sentence: "the eldest of three children", "the second
 * of three children", "the youngest of three children", or "the only child" for one. `null` when
 * the featured person's own birth year is unknown - a book cannot honestly call somebody "the
 * eldest" without knowing where they fall, so the fragment is dropped rather than guessed at.
 *
 * `siblings` is `family.byId`-shaped records ({id, by}), already the exact set `kin.js` calls
 * `full` within the `siblings` circle - children of both the same parents as the featured person -
 * never recomputed from the graph a second time.
 */
function birthOrderPhrase(featured, siblings) {
  if (featured.by === null) return null;
  const total = siblings.length + 1;
  if (total === 1) return 'the only child';
  const known = [{ id: featured.id, by: featured.by }, ...siblings.map((s) => ({ id: s.id, by: s.by }))]
    .sort((a, b) => (a.by === null) - (b.by === null) || (a.by ?? 0) - (b.by ?? 0) || byKey(a.id, b.id));
  const rank = known.findIndex((s) => s.id === featured.id);
  if (rank === 0) return `the eldest of ${countWords(total)} children`;
  if (rank === total - 1) return `the youngest of ${countWords(total)} children`;
  return `the ${ORDINALS[rank] ?? `${rank + 1}th`} of ${countWords(total)} children`;
}

/**
 * The Opening chapter's composed sentence: "Ankit was born in 1995, the eldest of three children
 * of Rajesh and Sunita. This is the family behind Ankit." Every clause is optional but the
 * featured person's own name, which `resolveFeatured` (or `namedBy`, `nameOf`) always supplies -
 * a missing birth year drops the year clause, a missing or absent-parent record drops "of Rajesh
 * and Sunita", and with neither parent named the birth-order fragment is dropped too, since
 * "the eldest of three children" with nobody to be a child of reads as a fact about nobody.
 */
export function openingLine(family, kin) {
  const featured = family.byId.get(kin.featured);
  const featuredName = nameOf(family, kin, kin.featured);
  if (!featured || !featuredName) return null;

  const parentNames = kin.circles.parents.map((id) => nameOf(family, kin, id)).filter(Boolean);
  const siblings = kin.circles.siblings
    .filter((id) => kin.people.get(id).role === 'full')
    .map((id) => ({ id, by: family.byId.get(id)?.by ?? null }));

  // The birth-order fragment needs the featured person's own birth year to be honest about it
  // (`birthOrderPhrase` already refuses without one); without it, the parents are still named,
  // just not ranked among their children.
  const order = parentNames.length ? birthOrderPhrase(featured, siblings) : null;
  const ofParents = parentNames.length ? `${order ?? 'a child'} of ${andList(parentNames)}` : null;
  const born = featured.by !== null ? `was born in ${featured.by}` : null;

  // `ofParents` is a noun phrase either way ("the eldest of three children of X" or "a child of
  // X"), so it reads as an appositive after `born` (a comma) or as "is ofParents" on its own -
  // never a verb missing its subject, whichever facts the record actually has.
  let sentence;
  if (born && ofParents) sentence = `${featuredName} ${born}, ${ofParents}.`;
  else if (born) sentence = `${featuredName} ${born}.`;
  else if (ofParents) sentence = `${featuredName} is ${ofParents}.`;
  else sentence = `${featuredName}.`;

  return `${sentence} This is the family behind ${featuredName}.`;
}

/**
 * The Roots chapter's line: "N generations before Ankit", from the most distant `gen` `kin.js`
 * placed anyone at, among the grandparents and ancestors circles - never a walk of its own. `null`
 * when neither circle holds anyone (the archetype skips the chapter, per the plan's adaptations).
 */
export function rootsLine(family, kin) {
  const featuredName = nameOf(family, kin, kin.featured);
  if (!featuredName) return null;
  const gens = [...kin.circles.grandparents, ...kin.circles.ancestors]
    .map((id) => kin.people.get(id).gen)
    .filter((g) => g !== null);
  if (!gens.length) return null;
  const n = -Math.min(...gens);
  return `${countWords(n, true)} generation${n === 1 ? '' : 's'} before ${featuredName}`;
}

/**
 * The caption for someone in "Still to be found" (storybook-plan.md #12): a name lost to the
 * record, placed by their relation to the featured person and, where `kin.js` knows it, which
 * side of the family they belong to - "Ankit's great-grandmother, on the maternal side". Only for
 * somebody neither named nor named through a neighbour (`nameOf` returning `null`); anyone else is
 * captioned by `nameOf` instead, on whichever page shows them.
 */
export function stillToBeFoundCaption(family, kin, id) {
  if (nameOf(family, kin, id)) return null;
  const featuredName = nameOf(family, kin, kin.featured);
  if (!featuredName) return null;
  const word = kinCaption(kin, family, id);
  if (!word) return null;
  const side = kin.people.get(id)?.side;
  const placed = `${possessive(featuredName)} ${word}`;
  return side && side !== 'none' ? `${placed}, on the ${side} side` : placed;
}
