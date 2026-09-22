/*
 * The book dialog's state, held apart from the DOM it is painted into.
 *
 * `book.js` owns a `<dialog>` and a live SVG preview; everything in here is the arithmetic and the
 * small decisions behind what that dialog shows, and none of it touches an element. That split is
 * what lets a Node test hold the option reducer, the size estimate's wording and the policy
 * decision's sentence to a table, the same way `nearby-words.js` holds nearby sharing's wording --
 * rather than trusting a screenshot to notice a reducer that quietly stopped clearing a field.
 */

import { buildGraph, branchFrom, restrictedGraph } from '../../site/playground/model.js';

/** What the dialog opens with, before anything is read from the tree. */
export const DEFAULT_OPTIONS = Object.freeze({
  templateId: null,
  /** `null` means "use the title the composer derives"; a string is a reader's own choice. */
  titleOverride: null,
  scopeKind: 'everyone',
  photos: true,
  livingDates: false,
  /** `null` means "let the composer pick" (`site/book/story/featured.js`); a string is a reader's own choice. */
  featured: null,
  /** Off by default: a note is the family's own words, and this book may be forwarded (`family.js`). */
  notes: false,
});

/**
 * `options.scope`, the shape `composeBook` and `decide()` both read.
 *
 * The branch person is fixed for as long as the dialog is open -- it is who it was opened from --
 * so it is carried alongside the options rather than inside them, and this is what turns the two
 * back into one value when it is time to compose.
 */
export function scopeFor(options, branchPersonId) {
  return options.scopeKind === 'branch' && branchPersonId
    ? { kind: 'branch', personId: branchPersonId }
    : { kind: 'everyone' };
}

/**
 * The graph the "Whose story" picker searches over: everyone in the file, or -- once scope narrows
 * the book to a branch -- exactly the people that branch would put in it. The same cut
 * `site/book/family.js` makes for the composer itself (`branchFrom` + `restrictedGraph`), so the
 * picker never offers somebody the book would leave out, and never a stale answer once the reader
 * flips "Who's in it".
 *
 * Built once per scope, not once per keystroke: `searchPeople` (`site/playground/search.js`) only
 * reads the graph it is given, so the caller is what decides how often this runs, and the book
 * dialog rebuilds it only when the document or the scope changes (`book.js`'s own gotcha, #249).
 */
export function pickerGraph(doc, options, branchPersonId) {
  const graph = buildGraph(doc);
  const scope = scopeFor(options, branchPersonId);
  return scope.kind === 'branch' && graph.people.has(scope.personId)
    ? restrictedGraph(graph, branchFrom(graph, scope.personId))
    : graph;
}

/**
 * Whether a template tells its story around one person.
 *
 * A format-2 storybook template does -- the featured person is who the pages are built for
 * (#256-258). A format-1 template like Heirloom does not yet: `composeBook` resolves a featured
 * person for every template (`site/book/story/featured.js`) but nothing in a format-1 book reads
 * it, so the dialog says so rather than let the picker sit there appearing to do nothing.
 */
export function featuresPerson(template) {
  return template?.format === 2;
}

/**
 * The options a template chip's own cover needs -- the same request, stopped at the first page.
 *
 * `composeBook`'s `coverOnly` (`site/book/compose.js`) is what makes this cheap: without it, every
 * chip nobody has picked still composes its whole book on every debounced keystroke, which is fine
 * at Heirloom's ten-odd pages and is not at the storybook's twenty-something (#249's own gotcha).
 */
export function coverOptions(baseOptions) {
  return { ...baseOptions, coverOnly: true };
}

/**
 * Today, as the composer requires it: a local date, never read from inside the composer itself
 * (`docs/family-book.md`'s determinism rule). Local, not UTC -- a book made at 11pm should carry
 * the date the reader is living in, not the one a UTC clock would round to.
 */
export function todayIso(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * "About 3.4 MB", or "About 220 KB" for anything the megabyte figure would round to 0.0.
 *
 * Deliberately approximate in its wording as well as its number -- `estimateBytes` is already an
 * estimate, and a reader deciding whether to include photographs wants a sense of scale, not a
 * byte count nobody asked for.
 */
export function formatEstimate(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'About 0 MB';
  if (bytes < 1_000_000) return `About ${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `About ${(bytes / 1_000_000).toFixed(1)} MB`;
}

/** The `decide()` shape into what `composeBook` will actually honour -- empty means "all of it". */
export function decisionAllowance(decision) {
  return decision?.kind === 'limited' ? decision.allowance : {};
}

/** Whether the dialog may let Save be pressed at all. Limited still saves; Locked never does. */
export function canSave(decision) {
  return decision?.kind !== 'locked';
}

/*
 * One sentence per reason `policy.js` can hand back -- see the reason codes documented at the top
 * of that file. A reason with no sentence here would leave the dialog saying nothing about why a
 * book was limited or locked, which is worse than the plainest possible wording.
 */
const REASONS = {
  'unknown-feature': 'This edition of f-tree does not have a book feature for the version installed.',
  'quota-used': 'The free plan’s book exports on this machine have been used up.',
  'generation-scope': 'The free plan covers only part of this family’s generations; the rest are left out below.',
  'premium-template': 'This template isn’t included in the free plan.',
  'not-included': 'This isn’t included in the free plan.',
  'malformed-rule': 'The policy that controls this couldn’t be read, so nothing has been changed.',
};

/** The sentence to show for a `decide()` result, or `null` for a plain Allowed. */
export function decisionMessage(decision) {
  if (!decision || decision.kind === 'allowed') return null;
  return REASONS[decision.reason] ?? 'This isn’t available right now.';
}

/**
 * `settings.bookUsage` with one feature counted once more.
 *
 * Pure, so the "only after a successful save" rule (`docs/premium.md`'s soft allowance) is one
 * call the save handler makes rather than something reached into the settings object to mutate.
 */
export function nextBookUsage(usage, feature) {
  const current = usage && typeof usage === 'object' ? usage : {};
  const before = Number.isInteger(current[feature]) ? current[feature] : 0;
  return { ...current, [feature]: before + 1 };
}

/** The `decide()` request for the whole-book export, built from what the family actually has. */
export function bookRequest({ templateId, templateTier = 'free', generations, people }) {
  return { feature: 'book.export', templateId, templateTier, generations, people };
}
