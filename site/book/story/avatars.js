/*
 * Which paper-cut figure stands for a person with no photograph (#253, docs/book-design-system.md,
 * "People"). Chosen from the record alone, so one person looks the same on every page and in every
 * book: gender, life stage, and a variant from a stable hash of the id.
 *
 *   avatarFor(person, ctx)  'avatar-<gender>-<stage>-<a|b>'  a faceless front bust, for medallions
 *   heroFor(person, ctx)    'hero-<gender>-<stage>'          seen from behind, at an arch window
 *
 * A hero is never a front bust: at hero size a faceless face reads as a placeholder, so a hero with
 * no photograph looks out at the view. The ids are drawings in art/src/papercut/avatars/.
 *
 * Composer code: deterministic, no clock (the year arrives in ctx), no locale, no randomness.
 */

export const GENDERS = Object.freeze(['female', 'male', 'person']);
export const STAGES = Object.freeze(['child', 'youth', 'adult', 'elder']);
export const VARIANTS = Object.freeze(['a', 'b']);

/** The record's gender as the art knows it: anything but MALE or FEMALE is unspecified. */
export const genderOf = (p) => (p?.gender === 'FEMALE' ? 'female' : p?.gender === 'MALE' ? 'male' : 'person');

/** A generation's typical distance in years, for guessing a stage when no year is recorded. */
const GENERATION_YEARS = 27;
/** How old the featured person is taken to be when their own birth year is not recorded. */
const FEATURED_AGE = 35;

const stageAt = (age) => (age < 13 ? 'child' : age < 30 ? 'youth' : age < 60 ? 'adult' : 'elder');

/**
 * The life stage: from the birth year against the book's year (the departed as they were when they
 * died); with no year, from the generation's distance to the featured person (`gen`, -1 a parent,
 * +1 a child), counted from F's age; with neither, adult. Never printed: no page gives an age.
 *
 * @param person  { by, dy } birth and death years or null (family.js)
 * @param ctx     { year } the book's year; { gen, featuredBy } where known
 */
export function lifeStage(person, { year, gen = null, featuredBy = null } = {}) {
  if (!Number.isInteger(year)) throw new Error('lifeStage: the book\'s year is required - the composer never reads the clock');
  if (Number.isInteger(person?.by)) return stageAt((Number.isInteger(person.dy) ? person.dy : year) - person.by);
  if (!Number.isInteger(gen)) return 'adult';
  const featuredAge = Number.isInteger(featuredBy) ? year - featuredBy : FEATURED_AGE;
  return stageAt(featuredAge - gen * GENERATION_YEARS);
}

/** A 32-bit FNV-1a hash of the id's UTF-16 code units: the same on every engine. */
function hash(id) {
  let h = 0x811c9dc5;
  const s = String(id);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** The front bust for a person without a photograph. The same id always gets the same variant. */
export function avatarFor(person, ctx) {
  const variant = VARIANTS[hash(person?.id ?? '') % VARIANTS.length];
  return `avatar-${genderOf(person)}-${lifeStage(person, ctx)}-${variant}`;
}

/** The hero seen from behind: youth and adult share a figure. */
export function heroFor(person, ctx) {
  const stage = lifeStage(person, ctx);
  return `hero-${genderOf(person)}-${stage === 'youth' ? 'adult' : stage}`;
}
