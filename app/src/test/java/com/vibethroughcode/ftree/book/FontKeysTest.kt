package com.vibethroughcode.ftree.book

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * `BookFonts.FILES` held to `site/book/font-keys.json`, the same table `font-keys.test.mjs`
 * reads for the four JavaScript/HTML sites (`FONT_KEYS` in `template.js`, `BOOK_FONT_FILES` in
 * `desktop/main.js`, the `@font-face` rules in `preview.html`, and `METRICS` in `metrics/index.js`)
 * -- see the comment on `FONT_KEYS` for why there are five sites and no shared constant. This is
 * the Kotlin side: `BookFonts.kt` is source, not data, so this reads it as text the way
 * `BookCatalogTest`'s format check reads `template.js` as text, rather than trying to instantiate a
 * class that needs an Android `Context`.
 */
class FontKeysTest {

    private val root: File = generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }
        .first { File(it, "settings.gradle.kts").exists() }

    @Test
    fun `BookFonts' map names exactly the shared list of font keys`() {
        val table = Json.parseToJsonElement(File(root, "site/book/font-keys.json").readText()).jsonObject
        val expected = table.getValue("keys").jsonArray.map { it.jsonPrimitive.content }

        val printer = File(root, "app/src/main/java/com/vibethroughcode/ftree/book/BookFonts.kt").readText()
        val found = Regex("\"(book_[a-z]+)\" to R\\.font\\.\\1").findAll(printer).map { it.groupValues[1] }.toList()

        assertEquals(expected, found)
    }

    @Test
    fun `every shared font key has a committed ttf`() {
        val table = Json.parseToJsonElement(File(root, "site/book/font-keys.json").readText()).jsonObject
        for (key in table.getValue("keys").jsonArray.map { it.jsonPrimitive.content }) {
            val ttf = File(root, "app/src/main/res/font/$key.ttf")
            assertTrue("$ttf is missing", ttf.isFile)
            assertTrue("$ttf is empty", ttf.length() > 0)
        }
    }
}
