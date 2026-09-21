package com.vibethroughcode.ftree.ui.book

import com.vibethroughcode.ftree.data.KinshipLanguage
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/**
 * `BookOptions` and the `options` object it turns into for the composer (#248) - pure Kotlin, so
 * this never needs a document, a template or the WebView `BookComposer` runs in.
 */
class BookOptionsTest {

    private val today = LocalDate.of(2026, 9, 21)

    @Test
    fun `defaults ask the composer to choose, keep notes off and speak English`() {
        val opts = BookOptions()
        assertNull(opts.featured)
        assertFalse(opts.notes)
        assertEquals("en", opts.words)
    }

    @Test
    fun `an unset featured is left out of the JSON entirely, not sent as null`() {
        val json = composerOptionsJson(BookOptions(featured = null), today, scopePersonId = null)
        assertFalse("featured" in json)
    }

    @Test
    fun `a chosen featured person is sent by id`() {
        val json = composerOptionsJson(BookOptions(featured = "person-7"), today, scopePersonId = null)
        assertEquals("person-7", json.getValue("featured").jsonPrimitive.content)
    }

    @Test
    fun `notes and words pass straight through`() {
        val json = composerOptionsJson(BookOptions(notes = true, words = "hi"), today, scopePersonId = null)
        assertTrue(json.getValue("notes").jsonPrimitive.boolean)
        assertEquals("hi", json.getValue("words").jsonPrimitive.content)

        val off = composerOptionsJson(BookOptions(notes = false, words = "en"), today, scopePersonId = null)
        assertFalse(off.getValue("notes").jsonPrimitive.boolean)
        assertEquals("en", off.getValue("words").jsonPrimitive.content)
    }

    @Test
    fun `coverOnly is only sent when true, matching composeBook's own default`() {
        val withoutIt = composerOptionsJson(BookOptions(), today, scopePersonId = null)
        assertFalse("coverOnly" in withoutIt)

        val withIt = composerOptionsJson(BookOptions(), today, scopePersonId = null, coverOnly = true)
        assertTrue(withIt.getValue("coverOnly").jsonPrimitive.boolean)
    }

    @Test
    fun `branch scope only applies when the screen was opened for somebody`() {
        val everyone = composerOptionsJson(BookOptions(branch = true), today, scopePersonId = null)
        assertEquals("everyone", everyone.getValue("scope").jsonObject.getValue("kind").jsonPrimitive.content)

        val branch = composerOptionsJson(BookOptions(branch = true), today, scopePersonId = "ankit")
        val scope = branch.getValue("scope").jsonObject
        assertEquals("branch", scope.getValue("kind").jsonPrimitive.content)
        assertEquals("ankit", scope.getValue("personId").jsonPrimitive.content)
    }

    @Test
    fun `turning branch off asks for everyone even when the screen was opened for somebody`() {
        val json = composerOptionsJson(BookOptions(branch = false), today, scopePersonId = "ankit")
        assertEquals("everyone", json.getValue("scope").jsonObject.getValue("kind").jsonPrimitive.content)
    }

    @Test
    fun `today never reads the clock - it is exactly what was passed in`() {
        val json = composerOptionsJson(BookOptions(), LocalDate.of(2030, 1, 2), scopePersonId = null)
        assertEquals("2030-01-02", json.getValue("now").jsonPrimitive.content)
    }

    @Test
    fun `an existing screen's options - photos, living dates and a title - are unaffected`() {
        val json = composerOptionsJson(BookOptions(photos = false, livingDates = true, title = "  The Kumars  "), today, scopePersonId = null)
        assertFalse(json.getValue("photos").jsonPrimitive.boolean)
        assertTrue(json.getValue("livingDates").jsonPrimitive.boolean)
        assertEquals("The Kumars", json.getValue("title").jsonPrimitive.content)
    }

    @Test
    fun `a blank title is left out, same as before this issue`() {
        val json = composerOptionsJson(BookOptions(title = "   "), today, scopePersonId = null)
        assertFalse("title" in json)
    }

    @Test
    fun `wordsFor maps the Family-words setting the way compose_js does`() {
        assertEquals("hi", wordsFor(KinshipLanguage.HINDI))
        assertEquals("en", wordsFor(KinshipLanguage.ENGLISH))
    }

    @Test
    fun `the JSON never carries a literal null - a missing key is how absence is said`() {
        val json = composerOptionsJson(BookOptions(), today, scopePersonId = null)
        for ((key, value) in json) assertTrue("$key was JSON null", value != JsonNull)
    }
}
