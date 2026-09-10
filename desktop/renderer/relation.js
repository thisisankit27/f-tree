/*
 * How two people are related, said in a sentence and drawn as a chain.
 *
 * The engine is `relate` in `site/playground/model.js` and none of it is here. What is here is the
 * wording, and the wording is the part with a decision in it: which of three sentences fits, and
 * when to say nothing at all.
 *
 * `sentenceFor` is separated from the drawing so it can be tested without a DOM -- there is no
 * jsdom in this project, and "which sentence does this answer get" is exactly the sort of thing
 * that should be checked by a table rather than by looking at a screenshot.
 */

import { displayName, spouseLabel } from '../../site/playground/model.js';
import { hindiTerm } from '../../site/playground/kinship-hindi.js';
import { hindiWord } from '../../site/playground/kinship-hi.js';

/**
 * The sentence for an answer, as parts rather than as a string.
 *
 * Parts, because the renderer needs to know which fragments are names and which is the term: names
 * are set in the running face and the term is emphasised, and handing back finished HTML would
 * mean building markup out of somebody's name in a file. Returns null where no sentence fits, and
 * that null is a decision rather than a gap -- see below.
 *
 * Three shapes, because a relationship through a marriage is not a noun the way a blood one is:
 *
 *   term       "Priya is Ankit's first cousin."
 *   marriedTo  "Madhu is married to Ankit's first cousin once removed."  -- because "Ankit's first
 *              cousin once removed's wife" is a possessive chain nobody says out loud, so it is
 *              turned around: the same fact, said the way a person would say it.
 *   ofSpouse   "Rekha is the mother of Ankit's wife."
 */
export function sentenceFor(result, from, to) {
  if (!result || result.kind !== 'related') return null;

  if (result.term) {
    return [
      { name: to }, ' is ', { name: from }, '’s ', { term: result.term }, '.',
    ];
  }
  if (result.marriedTo) {
    return [
      { name: to }, ' is married to ', { name: from }, '’s ',
      { term: result.marriedTo.term }, '.',
    ];
  }
  if (result.ofSpouse) {
    return [
      { name: to }, ' is the ', { term: result.ofSpouse.term }, ' of ', { name: from }, '’s ',
      spouseLabel(result.ofSpouse.spouse, null).toLowerCase(), '.',
    ];
  }

  /*
   * No sentence, deliberately, and the chain below says it instead.
   *
   * A sentence amounting to "these two are related somehow" tells a reader nothing the chain does
   * not tell them exactly. The website tried "connected only through marriage" and it was worse
   * than nothing: every relative anybody had married into the family came back under one flat
   * phrase, so the phrase stopped meaning anything. "My aunt's husband's brother" is what he is,
   * and the chain says it better than any invented word.
   */
  return null;
}

/**
 * The Hindi word for an answer, with its gloss, or null where Hindi has none.
 *
 * `word (gloss)` is how bilingual families actually speak, and it is what lets a younger relative
 * who does not know फूफा still read the answer. The gloss is more precise than English's own kinship
 * words on purpose: English says "uncle" five ways and the gloss says which one.
 *
 * Null everywhere Hindi genuinely has no word -- a second cousin, a relative through two marriages
 * -- and the panel then says the English sentence it would have said anyway. That is the same thing
 * a Hindi speaker does mid-conversation, and better than a Devanagari compound nobody says.
 */
export function hindiFor(result, from, to) {
  const term = hindiTerm(result?.kinship, from?.gender ?? 'UNSPECIFIED', to?.gender ?? 'UNSPECIFIED');
  const entry = hindiWord(term);
  return entry ? { ...entry, term } : null;
}

/** What to say when the file does not connect them at all. */
export function unrelatedWording(from, to) {
  return [
    'Nothing in this file connects ', { name: from }, ' to ', { name: to },
    '. They may still be related — the record simply does not say how.',
  ];
}

/**
 * Renders a sentence's parts into `into`, as elements rather than as markup.
 *
 * Names come out of somebody's file, so they are never concatenated into HTML. `textContent`
 * throughout: a person called `<b>` is a person, not a tag.
 */
export function paintSentence(into, parts) {
  into.replaceChildren();
  for (const part of parts) {
    if (typeof part === 'string') {
      into.append(document.createTextNode(part));
    } else if (part.term) {
      const em = document.createElement('b');
      em.textContent = part.term;
      into.append(em);
    } else {
      into.append(nameNode(part.name));
    }
  }
}

/** A person's name, in italics where the file does not record one, as everywhere else in the app. */
export function nameNode(person) {
  const name = displayName(person ?? {});
  if (person?.name) {
    const span = document.createElement('b');
    span.textContent = name;
    return span;
  }
  const em = document.createElement('em');
  em.textContent = name;
  return em;
}
