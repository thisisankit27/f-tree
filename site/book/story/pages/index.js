/*
 * The page archetypes: the one place that says what draws a planned storybook page.
 *
 * `story/plan.js` decides which pages the book has, what each one is about and what number it
 * carries; nothing there draws anything. This directory holds the drawing, one module per group of
 * archetypes, and this file is the dispatch `compose.js` looks a page up in. A page archetype is
 * never called by name from anywhere else: a plan says `archetype: 'gathering'`, and `PAGES` is
 * how that becomes ink.
 *
 * The archetypes are split across three issues (#239's wave 3), one module each, so that the three
 * can be written at the same time without touching each other's files:
 *
 *   hero.js    #256  cover, opening-hero, waiting, portrait-hero, closing
 *   family.js  #257  banyan, courtyards, gathering
 *   lists.js   #258  lane, numbers, register, still-to-be-found, legacy
 *
 * Together they must cover every archetype `plan.js`'s `VARIANTS` names. `compose.js` checks that
 * for itself - `DRAWABLE_FORMATS` gains 2 the day the last one lands, and not before - so no issue
 * has to remember to flip a flag, and a half-finished storybook refuses to draw by name instead of
 * printing a book with holes in it.
 *
 * STATIC IMPORTS ONLY, like the rest of the composer: Android stages this code by walking
 * `import ... from './x.js'` from compose.js (app/build.gradle.kts `bookEngine()`).
 */

import * as hero from './hero.js';
import * as family from './family.js';
import * as lists from './lists.js';

/**
 * Archetype id -> the function that draws one page of it:
 *
 *   draw(ctx, page, story) -> { label, items }
 *
 * `ctx`    compose.js's context. Beyond what format-1 blocks use (`line`, `lines`, `portrait`,
 *          `footer`, `page`, `measure`, `fit`, `gradient`, `P`, `tpl`, `family`, `facts`, `now`),
 *          a story page has `ctx.art` (art/draw.js over the whole compiled library: `place`,
 *          `zones`, `frame`, `box`), `ctx.featured` (the featured person's id, or null) and
 *          `ctx.options` (`photos`, `livingDates`, `words`, `notes`). `ctx.pageNo` is already this
 *          page's number, so `ctx.footer()` prints the right folio.
 * `page`   the `PagePlan` (story/plan.js): `pageNo`, `chapter`, `chapters`, `copyKey`, `archetype`,
 *          `variant`, `density`, `people`, `groups`, `continued`, `folds`. Draw what it says: an
 *          archetype never re-decides who a page is about, how the people group, or what number it
 *          carries.
 * `story`  `{ kin, plan }`: `kin` is story/kin.js's partition (circles, roles, `words(id)`), and
 *          `plan` the whole plan, for the pages that need the rest of the book - the register's
 *          page references (`plan.pagesOf`, `plan.registerOnly`), the legacy's line along F, and
 *          the shape the story took (`plan.shape`).
 *
 * Every archetype:
 *   - returns `ctx.page(label, items, ground)`, never a bare object;
 *   - calls `ctx.describePage({ archetype, variant, people, density })` from the plan, so the QA
 *     harness can check density and page-to-page variety;
 *   - calls `ctx.show(id)` for everyone it names or portrays (`ctx.portrait` already does);
 *   - says what each line is - `ctx.line(..., { kind: 'title' | 'body' | 'name' | 'caption' })` -
 *     so the type-size floors are checked against the right one;
 *   - marks the art it places with `ctx.zone('text' | 'face' | 'busy', box)`, so text-over-art is
 *     checked against something.
 *
 * All of it is composer code: deterministic, no clock, no locale, no DOM, no `Math.random`.
 */
export const PAGES = Object.freeze({ ...hero.PAGES, ...family.PAGES, ...lists.PAGES });
