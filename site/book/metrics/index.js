/*
 * The advance tables of every font a template may name, keyed as templates name them.
 *
 * The tables themselves are generated from the TTFs the release embeds (tools/font_metrics.mjs);
 * this file only gathers them, so the composer imports one module whatever the template.
 *
 * This object is one of five places that list the book's font keys and cannot import one another;
 * the other four are `FONT_KEYS` in `../template.js`, the hard-coded font map in
 * `app/.../book/BookFonts.kt`, `BOOK_FONT_FILES` in `desktop/main.js`, and the `@font-face` rules
 * in `../preview.html`. `../font-keys.json` plus `font-keys.test.mjs` and `FontKeysTest.kt` fail
 * the build if any of the five disagree.
 */

import bookDisplay from './book_display.js';
import bookText from './book_text.js';
import bookStrong from './book_strong.js';
import bookHand from './book_hand.js';

export const METRICS = Object.freeze({
  book_display: bookDisplay,
  book_text: bookText,
  book_strong: bookStrong,
  book_hand: bookHand,
});
