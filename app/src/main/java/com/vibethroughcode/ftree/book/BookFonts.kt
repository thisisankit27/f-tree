package com.vibethroughcode.ftree.book

import com.vibethroughcode.ftree.R

/**
 * The four faces a template may name, by font key, from the same files the desktop embeds. Static
 * instances, not variable fonts: Skia's PDF backend would otherwise write the text as Type3
 * outlines nobody can select or search (docs/fonts.md).
 *
 * [readBook] refuses a book naming any key not here (#246), so a face this release does not carry
 * is a clear refusal rather than a line of text silently left off the page, and [BookPrinter]
 * loads its typefaces from this same map - so what is checked and what is drawn with are one list.
 *
 * There is no Kotlin `FONT_KEYS` constant - this map is one of five places that list the book's
 * font keys and must be kept in step by hand with the other four: `FONT_KEYS` in
 * `site/book/template.js`, `BOOK_FONT_FILES` in `desktop/main.js`, the `@font-face` rules in
 * `site/book/preview.html`, and the tables gathered into `METRICS` in
 * `site/book/metrics/index.js`. `site/book/font-keys.json` plus `font-keys.test.mjs` and
 * `FontKeysTest.kt` fail the build if any of the five disagree.
 */
object BookFonts {
    val FILES: Map<String, Int> = mapOf(
        "book_display" to R.font.book_display,
        "book_text" to R.font.book_text,
        "book_strong" to R.font.book_strong,
        "book_hand" to R.font.book_hand,
    )
}
