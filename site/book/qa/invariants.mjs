/*
 * The family book's layout invariants (#245), as plain functions over a composed book and its
 * report (`composeWithReport`). Each returns a list of violations - strings that say what is wrong
 * and where - and an empty list when the book keeps the rule. invariants.test.mjs runs them over
 * every fixture, template and featured person, and proves each one fails on a book broken for the
 * purpose, so none of them can pass by checking nothing.
 *
 * The rules are docs/book-design-system.md's "Density" table and docs/storybook-plan.md's
 * "Verification" list. A few only mean something for the storybook (format 2) and are skipped,
 * with the reason, for a format-1 book - see `storyOnly` below.
 */

import { estimateBytes } from '../compose.js';

/** The design system's floors, by what the page said a line is (`ctx.line(..., { kind })`). */
export const SIZE_FLOORS = Object.freeze({ body: 10.5, name: 9, caption: 8 });
/** Nothing in a storybook prints smaller than this. */
export const STORY_MIN_SIZE = 7;
/*
 * Format 1 was designed before the storybook's density table and promises less: the tree page
 * keeps "room for a name at 6 points or more under every portrait" (blocks/tree.js) and prints the
 * years under a name at 6.4. Heirloom's output is frozen byte for byte, so format-1 books are held
 * to their own promise, and the 7 pt floor is a storybook rule.
 */
export const FORMAT1_MIN_SIZE = 6;

/** People a page of each density may carry (design system, "Density"). */
export const DENSITY_CAPS = Object.freeze({ hero: [1, 2], family: [1, 8], gathering: [1, 12], lane: [1, 32], register: [1, 48] });

export const MAX_BOOK_JSON = 1_500_000;
export const MAX_PAGE_JSON = 150_000;
export const MAX_PDF = 10_000_000;

/*
 * A line at this opacity or fainter is ornament, not reading text: Heirloom's 120 pt generation
 * numeral sits behind the heading at 0.2 on purpose, as a watermark. A page may also say so with
 * `kind: 'ornament'`. Ornament is still held to the size floors; it is left out of the collision
 * checks, which are about words someone has to read.
 */
export const ORNAMENT_OPACITY = 0.35;
const reading = (b) => b.kind !== 'ornament' && b.op > ORNAMENT_OPACITY;

const overlap = (a, b, slack = 0.5) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > slack && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > slack;
const quote = (s) => `"${s.length > 40 ? `${s.slice(0, 37)}...` : s}"`;

/** Everyone in scope is named or portrayed somewhere: the register's promise. */
export function everyoneShown({ scope, report }) {
  return [...scope].filter((id) => !report.shown[id]?.length).map((id) => `${id} is in scope but on no page`);
}

/** No line smaller than the floor for its kind, or than the book's floor for anything. */
export function sizes({ book, report }) {
  const out = [];
  const story = book.format >= 2;
  const min = story ? STORY_MIN_SIZE : FORMAT1_MIN_SIZE;
  for (const b of report.textBoxes) {
    if (b.size < min - 1e-9) out.push(`page ${b.page}: ${quote(b.s)} at ${b.size} pt, under ${min} pt`);
    const floor = SIZE_FLOORS[b.kind];
    if (floor && b.size < floor - 1e-9) out.push(`page ${b.page}: ${b.kind} ${quote(b.s)} at ${b.size} pt, under ${floor} pt`);
    // A storybook line that says nothing about what it is cannot be held to its floor, which is a
    // hole in this check, not a pass.
    if (story && !b.kind) out.push(`page ${b.page}: ${quote(b.s)} has no kind - pass ctx.line(..., { kind }) so its floor can be checked`);
  }
  return out;
}

/** No reading text over other reading text, on the same page. */
export function noTextOverlap({ report }) {
  const out = [];
  const byPage = new Map();
  for (const b of report.textBoxes.filter(reading)) {
    const list = byPage.get(b.page) ?? [];
    for (const o of list) if (overlap(o, b)) out.push(`page ${b.page}: ${quote(o.s)} and ${quote(b.s)} overlap`);
    list.push(b);
    byPage.set(b.page, list);
  }
  return out;
}

/** No reading text in a zone the art marked busy (or over a face). */
export function noTextInBusyArt({ report }) {
  const out = [];
  for (const z of report.artZones.filter((z) => z.kind === 'busy' || z.kind === 'face')) {
    for (const b of report.textBoxes) {
      if (b.page === z.page && reading(b) && overlap(b, z)) out.push(`page ${b.page}: ${quote(b.s)} sits in a ${z.kind} zone`);
    }
  }
  return out;
}

/** No two consecutive pages share both a composition and an art placement. */
export function consecutivePagesVary({ report }) {
  const out = [];
  report.pages.forEach((p, i) => {
    if (!p.archetype) { out.push(`page ${p.page} (${p.label}) does not describe its archetype - ctx.describePage it`); return; }
    const prev = report.pages[i - 1];
    if (prev?.archetype === p.archetype && prev.variant === p.variant) out.push(`pages ${prev.page} and ${p.page} are both ${p.archetype}/${p.variant}`);
  });
  return out;
}

/** People-per-page caps: heroes 1-2, family pages 8, gatherings 12, a lane 32, the register 48. */
export function peoplePerPage({ report }) {
  const out = [];
  for (const p of report.pages) {
    if (!p.people.length) continue;
    const cap = DENSITY_CAPS[p.density];
    if (!cap) { out.push(`page ${p.page} (${p.label}) shows ${p.people.length} people but no density row - describePage({ density })`); continue; }
    if (p.people.length < cap[0] || p.people.length > cap[1]) out.push(`page ${p.page} (${p.label}) is a ${p.density} page with ${p.people.length} people, outside ${cap[0]}-${cap[1]}`);
  }
  return out;
}

/*
 * How many pages a book may have for a family of n. Loose on purpose: this catches a book that
 * runs away or comes up empty, not one that is a page longer than it was.
 *   - format 1: cover, tree, numbers, closing and at least one generations page; at most about a
 *     page of generations per ten people and an index page per hundred;
 *   - storybook: an empty tree is a cover, a "waiting for its family" page and the closing; a tiny
 *     family (<= 4) collapses to 3-7 pages; otherwise 5 up to the plan's ~28 story pages, plus the
 *     register at 48 a page (docs/storybook-plan.md).
 */
export function pageBounds(format, n) {
  if (format === 1) return [5, 5 + Math.ceil(n / 10) + Math.ceil(n / 100)];
  if (n === 0) return [3, 4];
  if (n <= 4) return [3, 7];
  return [5, 30 + Math.ceil(n / 48)];
}

export function pageCount({ book, scope }) {
  const [lo, hi] = pageBounds(book.format, scope.size);
  const n = book.pages.length;
  return n < lo || n > hi ? [`${n} pages for ${scope.size} people, outside ${lo}-${hi}`] : [];
}

/** JSON the painter is handed: the book and each page within their budgets. */
export function jsonBudget({ book }) {
  const out = [];
  const total = JSON.stringify(book).length;
  if (total > MAX_BOOK_JSON) out.push(`the book is ${total} bytes of JSON, over ${MAX_BOOK_JSON}`);
  book.pages.forEach((p, i) => {
    const n = JSON.stringify(p).length;
    if (n > MAX_PAGE_JSON) out.push(`page ${i + 1} (${p.label}) is ${n} bytes of JSON, over ${MAX_PAGE_JSON}`);
  });
  return out;
}

/** The PDF stays under 10 MB on the painter that writes the larger one (Android's lossless). */
export function pdfBudget({ book }) {
  const est = estimateBytes(book, { lossless: true });
  return est >= MAX_PDF ? [`estimated ${est} bytes, not under ${MAX_PDF}`] : [];
}

/*
 * No living person's age. A living person with a birth year is N or N-1 in the book's year; any
 * page text that pairs either number with years, yrs, year-old, साल or वर्ष, or that says "age N" or
 * "aged N", is flagged. The one "N years" a book may print is a departed person's recorded life,
 * so a number that is some departed person's span is let through - which means a living age that
 * happens to equal one is missed, the price of not false-failing the numbers page.
 */
export function noLivingAge({ doc, book, report, year }) {
  const people = doc.people ?? [];
  const born = (p) => Number(/^(\d{4})/.exec(p.birthDate ?? '')?.[1] ?? NaN);
  const died = (p) => Number(/^(\d{4})/.exec(p.deathDate ?? '')?.[1] ?? NaN);
  const spans = new Set(people.filter((p) => p.deceased || p.deathDate).map((p) => died(p) - born(p)).filter(Number.isFinite));
  const living = people.filter((p) => !p.deceased && !p.deathDate && Number.isFinite(born(p)));
  const out = [];
  const pages = new Map();
  for (const b of report.textBoxes) pages.set(b.page, `${pages.get(b.page) ?? ''} ${b.s}`);
  for (const p of living) {
    for (const n of [year - born(p), year - born(p) - 1]) {
      if (n < 0 || spans.has(n)) continue;
      const age = new RegExp(`(?:\\b${n}\\s*-?\\s*(?:years?|yrs?|year-old)\\b)|(?:\\baged?\\s+${n}\\b)|(?:\\b${n}\\s*(?:साल|वर्ष))`, 'i');
      for (const [page, words] of pages) {
        if (age.test(words)) out.push(`page ${page} (${book.pages[page - 1].label}) may give ${p.name ?? p.id} (born ${born(p)}) an age: ${age.exec(words)[0]}`);
      }
    }
  }
  return out;
}

/** Every invariant, and which only mean something for a storybook. */
export const INVARIANTS = Object.freeze({
  everyoneShown: { check: everyoneShown },
  sizes: { check: sizes },
  noTextOverlap: { check: noTextOverlap },
  noTextInBusyArt: { check: noTextInBusyArt },
  consecutivePagesVary: { check: consecutivePagesVary, storyOnly: 'a format-1 book has no archetypes: its page order is the template\'s fixed list' },
  peoplePerPage: { check: peoplePerPage, storyOnly: 'the density caps are the storybook\'s; format-1 generation pages pack by portrait size instead' },
  pageCount: { check: pageCount },
  jsonBudget: { check: jsonBudget },
  pdfBudget: { check: pdfBudget },
  noLivingAge: { check: noLivingAge },
});
