/*
 * The person panel's edits, before they are kept.
 *
 * Until 0.6 the panel committed on every field's `change` event: nothing on screen said an edit had
 * been taken, closing the panel did not commit, and a field still focused when it closed relied on
 * the browser firing `change` on blur (#148). The phone never worked that way. Its edit screen holds
 * the form in memory with a dirty flag, validates the dates, and writes on an explicit Save, with a
 * discard dialog on the way out -- so this is that, ported, and pure so it can be tested without a
 * page.
 *
 * The rules are `PersonEditViewModel.kt`'s, and the ones that are easy to get subtly wrong are
 * spelled out where they live: which date problems block a save, and how a death date and "no
 * longer living" pull on each other.
 */

import { parsePartialDate } from '../../site/playground/dates.js';

/** Why a date somebody typed cannot be kept. The Kotlin's `DateProblem`, by name. */
export const DateProblem = Object.freeze({
  MALFORMED: 'MALFORMED',
  DEATH_BEFORE_BIRTH: 'DEATH_BEFORE_BIRTH',
});

/** The fields the panel edits. A photograph is not one: it is framed and kept by its own dialog. */
export const DRAFT_FIELDS = ['name', 'gender', 'birthDate', 'deathDate', 'deceased', 'notes'];

/** What the form shows for a person, as strings and a boolean -- never null. */
export function draftFrom(person) {
  return {
    name: person?.name ?? '',
    gender: person?.gender ?? '',
    birthDate: person?.birthDate ?? '',
    deathDate: person?.deathDate ?? '',
    deceased: Boolean(person?.deceased),
    notes: person?.notes ?? '',
  };
}

/**
 * One field changed, with the two rules that tie a death to its date.
 *
 * Both from the Kotlin, and both about keeping the record consistent rather than about convenience:
 * recording a death date says the person has died, so the switch follows the fact; and clearing
 * "no longer living" would leave a death date stranded, so the date goes with it.
 */
export function withChange(draft, key, value) {
  const next = { ...draft, [key]: value };
  if (key === 'deathDate' && String(value).trim()) next.deceased = true;
  if (key === 'deceased' && !value) next.deathDate = '';
  return next;
}

/**
 * What is wrong with the two dates, field by field.
 *
 * Only a date that cannot be understood, or an *impossible* order, is a problem. Overlapping partial
 * dates are left alone -- "born 1938, died 1938" is a real thing to record -- so the comparison is
 * the latest the death could be against the earliest the birth could be. A blank date is not a
 * problem at all: most of a family tree is people whose dates nobody knows.
 */
export function dateProblems(draft) {
  const birthText = String(draft.birthDate ?? '').trim();
  const deathText = String(draft.deathDate ?? '').trim();
  const birth = parsePartialDate(birthText);
  const death = parsePartialDate(deathText);

  const problems = {
    birthDate: birthText && !birth ? DateProblem.MALFORMED : null,
    deathDate: deathText && !death ? DateProblem.MALFORMED : null,
  };
  if (!problems.deathDate && birth && death && death.latest() < birth.earliest()) {
    problems.deathDate = DateProblem.DEATH_BEFORE_BIRTH;
  }
  return problems;
}

/** A completely blank form is valid: it records a person whose details nobody knows yet. */
export function canSave(draft) {
  const problems = dateProblems(draft);
  return !problems.birthDate && !problems.deathDate;
}

/** Text compared as it will be kept: `Tree.updatePerson` trims, so a trailing space is no edit. */
const kept = (value) => (typeof value === 'string' ? value.trim() : value);

/** Whether the form says something the tree does not. */
export function isDirty(draft, person) {
  const saved = draftFrom(person);
  return DRAFT_FIELDS.some((key) => kept(draft[key]) !== kept(saved[key]));
}

/**
 * The fields to hand `Tree.updatePerson`.
 *
 * Every field is named, including the empty ones, because naming a field with an empty value is how
 * `updatePerson` is told to clear it -- a field left out would be left as it was.
 */
export function fieldsFrom(draft) {
  return {
    name: draft.name,
    gender: draft.gender || null,
    birthDate: draft.birthDate,
    deathDate: draft.deathDate,
    deceased: draft.deceased,
    notes: draft.notes,
  };
}

/** Nothing recorded about this person at all -- the state "Add a person" creates them in. */
export function isBlankPerson(person) {
  if (!person) return false;
  return !person.name && !person.gender && !person.birthDate && !person.deathDate
    && !person.deceased && !person.notes && !person.photo;
}

/**
 * A date as it is typed, with any separator a person reaches for turned into the one the format uses.
 *
 * #90: the format is strict on purpose -- `1938`, `1938-04`, `1938-04-17`, because the precision is
 * the statement about how much is known -- which makes the hyphen the only separator it accepts.
 * So a space, a slash or a full stop becomes a hyphen *as it is typed*, and the parser stays exactly
 * as strict as it was. A separator cannot lead, and cannot double up: leaning on the spacebar gives
 * `1938-04`, never `1938--04` or `-1938`.
 *
 * Nothing is inserted, only replaced or dropped, so backspace goes back through a hyphen one press
 * at a time. The caret is returned because dropping a character before it would otherwise leave it
 * one place too far along.
 *
 * @param {string} value what the field holds after the keystroke
 * @param {number} caret where the caret is in `value`
 * @returns {{value: string, caret: number}}
 */
export function normaliseDateTyping(value, caret = value.length) {
  let out = '';
  let at = caret;
  for (let i = 0; i < value.length; i += 1) {
    const char = /[\s./]/.test(value[i]) ? '-' : value[i];
    if (char === '-' && (out === '' || out.endsWith('-'))) {
      if (i < caret) at -= 1;
      continue;
    }
    out += char;
  }
  return { value: out, caret: Math.max(0, at) };
}
