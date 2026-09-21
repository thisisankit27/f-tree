package com.vibethroughcode.ftree.book

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlin.math.max

/**
 * Book format 2 (#246) read in Kotlin: clip, symbols and `use`, held to the conformance book the
 * JavaScript half is held to (`site/book/golden/format2-conformance.json`), to a refusal for each
 * rule `validateBook` makes, and - where node is on the path - to `format.js`'s own `validateBook`
 * on the very same books, so the two languages accept exactly the same ones.
 *
 * What needs `android.graphics` (the painting itself, the path cache inside a real painter, the
 * silhouette's pixels) is `BookPdfTest`'s, on a device.
 */
class BookFormat2Test {

    private val root: File = generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }
        .first { File(it, "settings.gradle.kts").exists() }

    private fun conformance() = File(root, "site/book/golden/format2-conformance.json").readText()
    private fun heirloom() = File(root, "site/book/golden/sample-heirloom.json").readText()

    // --- the conformance book --------------------------------------------------------------------

    @Test
    fun `the conformance book reads with every format 2 feature in it`() {
        val book = readBook(conformance())
        assertEquals(Book.FORMAT_MAX, book.format)
        assertEquals(setOf("diya", "lamp-pair", "toran", "keepsake"), book.symbols.keys)
        assertEquals(4, book.pages.size)

        val seen = mutableSetOf<String>()
        fun walk(items: List<Item>, inSymbol: Boolean) {
            for (it in items) when (it) {
                is Item.Group -> {
                    if (it.clip != null) seen += "clip"
                    if (it.clip != null && it.tf != null) seen += "clip inside a tf"
                    if (it.clip != null && it.op != null) seen += "clip under an op"
                    if (inSymbol && it.tf != null) seen += "a turned group in a symbol"
                    walk(it.items, inSymbol)
                }
                is Item.Use -> {
                    seen += if (inSymbol) "a use in a symbol" else "a use on a page"
                    if (it.tf != null) seen += "a use with a tf"
                    if (it.op != null) seen += "a use with an op"
                    if (it.fill != null) seen += "a silhouette"
                }
                is Item.Circle -> {
                    if (inSymbol && it.fill == null && it.stroke != null) seen += "a stroke-only ring in a symbol"
                    if (inSymbol && it.fill is Fill.Ref) seen += "a gradient in a symbol"
                }
                else -> Unit
            }
        }
        book.pages.forEach { walk(it.items, false) }
        book.symbols.values.forEach { walk(it.items, true) }
        assertEquals(
            setOf(
                "clip", "clip inside a tf", "clip under an op", "a turned group in a symbol", "a use in a symbol",
                "a use on a page", "a use with a tf", "a use with an op", "a silhouette", "a stroke-only ring in a symbol",
                "a gradient in a symbol",
            ),
            seen,
        )
    }

    @Test
    fun `the conformance book reads without loss`() {
        val raw = Json.parseToJsonElement(conformance())
        val again = Json.parseToJsonElement(BookJson.encodeToString(Book.serializer(), readBook(conformance())))
        assertSameJson(raw, again, "book")
    }

    @Test
    fun `the conformance book read and written again is the same book`() {
        val book = readBook(conformance())
        assertEquals(book, readBook(BookJson.encodeToString(Book.serializer(), book)))
    }

    @Test
    fun `the silhouette use keeps its colour and the symbol keeps its stroke`() {
        val book = readBook(conformance())
        val shadow = book.pages[3].items.filterIsInstance<Item.Use>().first()
        assertEquals("keepsake", shadow.ref)
        assertEquals(Colour(0xFF2a1a33.toInt()), shadow.fill)
        assertEquals(0.4f, shadow.op)
        val ring = book.symbols.getValue("keepsake").items[1] as Item.Circle
        assertNull("the ring has no fill for a silhouette to give it", ring.fill)
        assertEquals(3f, ring.sw)
    }

    // --- format ----------------------------------------------------------------------------------

    @Test
    fun `the format is read before anything else in the book`() {
        // Nothing else here would parse: the format alone decides, and the message says so.
        val message = refusal("""{"format":3,"pages":"a hologram","t":"sphere"}""")
        assertTrue(message, "format 3" in message)
        assertTrue(message, "Update f-tree" in message)
    }

    @Test
    fun `a format this app does not draw is refused`() {
        for (format in listOf("3", "0", "\"2\"", "null", "2.5")) {
            refusal(conformance().replaceFirst("\"format\": 2", "\"format\": $format"))
        }
        refusal(conformance().replaceFirst("\"format\": 2,", ""))
    }

    @Test
    fun `a book declares exactly the format it draws with`() {
        assertTrue(refusal(conformance().replaceFirst("\"format\": 2", "\"format\": 1")).contains("draws as format 2"))
        assertTrue(refusal(heirloom().replaceFirst("\"format\":1", "\"format\":2")).contains("draws as format 1"))
        assertEquals(Book.FORMAT, readBook(heirloom()).format)
    }

    @Test
    fun `the limits and formats are the ones format js exports`() {
        val js = File(root, "site/book/format.js").readText()
        fun constant(name: String) = Regex("export const $name = (\\d+);").find(js)?.groupValues?.get(1)?.toInt()
        assertEquals(constant("FORMAT"), Book.FORMAT)
        assertEquals(constant("FORMAT_MAX"), Book.FORMAT_MAX)
        assertEquals(constant("MAX_SYMBOL_DEPTH"), Book.MAX_SYMBOL_DEPTH)
        assertEquals(constant("MAX_EXPANDED_ITEMS"), Book.MAX_EXPANDED_ITEMS)
    }

    // --- clips -----------------------------------------------------------------------------------

    @Test
    fun `a clip a painter can follow is read`() {
        for (clip in GOOD_CLIPS) readBook(book(listOf(group(clip))))
    }

    @Test
    fun `a clip a painter could not follow is refused, not drawn as an empty page`() {
        for (clip in BAD_CLIPS) {
            val message = refusal(book(listOf(group(clip))))
            assertTrue("$clip: $message", "clip path data" in message)
        }
        // Not a string at all: the type refuses it.
        for (clip in listOf("42", """{"d":"M0 0"}""")) refusal(book(listOf("""{"t":"group","clip":$clip,"items":[]}""")))
    }

    @Test
    fun `path data follows the one grammar`() {
        assertEquals(listOf(0.0 to 0.0, 10.0 to 0.0, 10.0 to 10.0), pathPoints("M0 0 L10 0 10 10Z"))
        assertEquals(listOf(0.0 to 0.0, 10.0 to 0.0, 10.0 to 10.0, 0.0 to 10.0), pathPoints("M0 0 H10 V10 H0 Z"))
        assertEquals(listOf(0.0 to 0.0, 5.0 to -5.0, 10.0 to 0.0), pathPoints("M0,0Q5,-5,10,0"))
        assertEquals(listOf(0.5 to 0.5, 1e-3 to 2.0), pathPoints("M.5.5L1e-3 2"))
        assertNotNull("JavaScript's \\s is the separator's whitespace", pathPoints("M0\u00a00\u2028L1\uFEFF1"))
        assertEquals("-0 is 0", 1, pathPoints("M-0 0 L0 -0")?.toSet()?.size)
        for (bad in listOf("", "   ", "L1 1", "M0 0 L1", "M0 0 X", "M0 0 L+1 1", "M1e999 0", "M0 0 Z 5")) assertNull(bad, pathPoints(bad))
        // A path, unlike a clip, may be open or empty; one that does not parse is still refused.
        readBook(book(listOf("""{"t":"path","d":"","stroke":"#2a1a33","sw":1}""", """{"t":"path","d":"M0 0 L1 1","stroke":"#2a1a33","sw":1}"""), format = 1))
        assertTrue(refusal(book(listOf("""{"t":"path","d":"M0 0 A1 1 0 0 1 2 2","stroke":"#2a1a33","sw":1}"""), format = 1)).contains("path data"))
    }

    // --- symbols and use -------------------------------------------------------------------------

    @Test
    fun `a use names a symbol the book carries, never one a prototype lends it`() {
        val diya = """{"diya":{"items":[$RECT]}}"""
        readBook(book(listOf(use("diya")), diya))
        for (ref in listOf("nope", "constructor", "__proto__", "toString", "hasOwnProperty", "valueOf")) {
            val message = refusal(book(listOf(use(ref)), diya))
            assertTrue("$ref: $message", "unknown symbol $ref" in message)
        }
    }

    @Test
    fun `symbols may nest four deep and no deeper`() {
        readBook(book(listOf(use("s1")), chain(Book.MAX_SYMBOL_DEPTH)))
        val message = refusal(book(listOf(use("s1")), chain(Book.MAX_SYMBOL_DEPTH + 1)))
        assertTrue(message, "nested 5 deep" in message)
    }

    @Test
    fun `a symbol that reaches itself is refused`() {
        assertTrue(refusal(book(listOf(use("a")), """{"a":{"items":[${use("a")}]}}""")).contains("used through itself"))
        assertTrue(refusal(book(listOf(use("a")), """{"a":{"items":[${use("b")}]},"b":{"items":[{"t":"group","items":[${use("a")}]}]}}""")).contains("used through itself"))
    }

    @Test
    fun `a page may draw twenty thousand items once expanded, and no more`() {
        readBook(book(List(66) { use("row") }, rows()))   // 66 x (1 + 150 x 2) = 19866
        val message = refusal(book(List(70) { use("row") }, rows()))   // 21070
        assertTrue(message, "draws 21070 items once expanded" in message)
    }

    @Test
    fun `symbols are a map with something in it, or absent`() {
        for (symbols in listOf("{}", "null", "[]", "\"diya\"")) refusal(book(listOf(RECT), symbols))
        assertTrue(refusal(book(listOf(RECT), "{}")).contains("symbols is empty"))
    }

    @Test
    fun `a symbol holds shapes only, under a proper id`() {
        refusal(book(listOf(use("s")), """{"s":{"items":[{"t":"text","x":0,"y":0,"s":"hi","font":"text","size":9,"fill":"#2a1a33"}]}}"""))
        refusal(book(listOf(use("s")), """{"s":{"items":[{"t":"image","id":"p1","x":0,"y":0,"w":9,"h":9,"clip":"rect"}]}}"""))
        for (id in listOf("-lead", "two words", "\u00e9", "")) {
            assertTrue(id, refusal(book(listOf(use(id)), """{${q(id)}:{"items":[$RECT]}}""")).contains("not an id"))
        }
    }

    @Test
    fun `a silhouette is one solid colour, never a gradient`() {
        val symbols = """{"diya":{"items":[$RECT]}}"""
        readBook(book(listOf(use("diya", ""","fill":"#2a1a33","op":0.4""")), symbols, defs = DEFS))
        refusal(book(listOf(use("diya", ""","fill":{"ref":"sheen"}""")), symbols, defs = DEFS))
        refusal(book(listOf(use("diya", ""","fill":"red"""")), symbols, defs = DEFS))
    }

    @Test
    fun `a use's transform and opacity are checked as a group's are`() {
        val symbols = """{"diya":{"items":[$RECT]}}"""
        refusal(book(listOf(use("diya", ""","tf":[1,0,0,1,5]""")), symbols))
        refusal(book(listOf(use("diya", ""","op":1.5""")), symbols))
    }

    // --- fonts and gradients ---------------------------------------------------------------------

    @Test
    fun `a book naming a face this app does not carry is refused, naming the face and the ones it has`() {
        val message = refusal(conformance().replace("\"strong\": \"book_strong\"", "\"strong\": \"book_serif\""))
        assertTrue(message, "book_serif" in message)
        assertTrue(message, "\"strong\"" in message)
        for (key in BookFonts.FILES.keys) assertTrue("$key in: $message", key in message)
        assertTrue(message, "update f-tree" in message)
    }

    @Test
    fun `every face the printer carries is one a book may name`() {
        val every = BookFonts.FILES.keys.joinToString(",", "{", "}") { """"${it.removePrefix("book_")}":"$it"""" }
        readBook(book(listOf(RECT), format = 1, fonts = every))
        // And the check is against the list it is given, not a copy of its own.
        refusal(book(listOf(RECT), format = 1), fontKeys = setOf("book_display"))
    }

    @Test
    fun `a line of text in a role the book does not set is refused`() {
        refusal(book(listOf("""{"t":"text","x":0,"y":9,"s":"Dadi","font":"hand","size":9,"fill":"#2a1a33"}"""), format = 1))
    }

    @Test
    fun `a gradient the book does not carry is refused, not skipped`() {
        refusal(book(listOf("""{"t":"rect","x":0,"y":0,"w":1,"h":1,"fill":{"ref":"nope"}}"""), format = 1))
        refusal(book(listOf("""{"t":"rect","x":0,"y":0,"w":1,"h":1,"fill":{"ref":"constructor"}}"""), format = 1))
        // An item-relative glow belongs on a circle and nowhere else.
        refusal(book(listOf("""{"t":"rect","x":0,"y":0,"w":1,"h":1,"fill":{"ref":"glow"}}"""), format = 1, defs = DEFS))
        readBook(book(listOf("""{"t":"circle","cx":5,"cy":5,"r":5,"fill":{"ref":"glow"}}"""), format = 1, defs = DEFS))
    }

    // --- the path cache --------------------------------------------------------------------------

    @Test
    fun `a path drawn many times is parsed once`() {
        val calls = mutableListOf<Pair<String, Boolean>>()
        val cache = PathCache { d, evenOdd -> calls += d to evenOdd; StringBuilder(d) }
        val lamp = "M0 0 L24 0 C22.5 8.5 18 12.6 12 12.6 Z"
        val first = cache[lamp]
        repeat(40) { assertSame(first, cache[lamp]) }
        cache["M0 0 L1 1"]
        // The same data under the other fill rule is its own parse, so neither leaks its rule.
        val evenOdd = cache[lamp, true]
        assertTrue(evenOdd !== first)
        assertSame(evenOdd, cache[lamp, true])
        assertEquals(listOf(lamp to false, "M0 0 L1 1" to false, lamp to true), calls)
        assertEquals(3, cache.parsed)
    }

    // --- one answer in both languages ------------------------------------------------------------

    /**
     * Every book this file reads or refuses, handed to `format.js`'s `validateBook` too: the two
     * must accept exactly the same books. The one case left out is a font key, which only an app
     * can check - validateBook does not know which faces a release carries.
     */
    @Test
    fun `validateBook in JavaScript accepts exactly the books readBook does`() {
        val node = nodeOrSkip()
        val symbols = """{"diya":{"items":[$RECT]}}"""
        val cases = buildList {
            add(conformance()); add(heirloom())
            add(conformance().replaceFirst("\"format\": 2", "\"format\": 1"))
            add(heirloom().replaceFirst("\"format\":1", "\"format\":2"))
            add(conformance().replaceFirst("\"format\": 2", "\"format\": 3"))
            add(conformance().replaceFirst("\"format\": 2", "\"format\": \"2\""))
            GOOD_CLIPS.forEach { add(book(listOf(group(it)))) }
            BAD_CLIPS.forEach { add(book(listOf(group(it)))) }
            add(book(listOf("""{"t":"group","clip":42,"items":[]}""")))
            listOf("diya", "nope", "constructor", "__proto__", "toString").forEach { add(book(listOf(use(it)), symbols)) }
            add(book(listOf(use("s1")), chain(4))); add(book(listOf(use("s1")), chain(5)))
            add(book(listOf(use("a")), """{"a":{"items":[${use("a")}]}}"""))
            add(book(List(66) { use("row") }, rows())); add(book(List(70) { use("row") }, rows()))
            listOf("{}", "null", "[]").forEach { add(book(listOf(RECT), it)) }
            add(book(listOf(use("-lead")), """{"-lead":{"items":[$RECT]}}"""))
            add(book(listOf(use("s")), """{"s":{"items":[{"t":"text","x":0,"y":0,"s":"hi","font":"text","size":9,"fill":"#2a1a33"}]}}"""))
            add(book(listOf(use("diya", ""","fill":"#2a1a33","op":0.4""")), symbols, defs = DEFS))
            add(book(listOf(use("diya", ""","fill":{"ref":"sheen"}""")), symbols, defs = DEFS))
            add(book(listOf(use("diya", ""","tf":[1,0,0,1,5]""")), symbols))
            add(book(listOf(use("diya", ""","op":1.5""")), symbols))
            add(book(listOf("""{"t":"path","d":"M0 0 A1 1 0 0 1 2 2","stroke":"#2a1a33","sw":1}"""), format = 1))
            add(book(listOf("""{"t":"text","x":0,"y":9,"s":"Dadi","font":"hand","size":9,"fill":"#2a1a33"}"""), format = 1))
            add(book(listOf("""{"t":"rect","x":0,"y":0,"w":1,"h":1,"fill":{"ref":"constructor"}}"""), format = 1))
            add(book(listOf("""{"t":"rect","x":0,"y":0,"w":1,"h":1,"fill":{"ref":"glow"}}"""), format = 1, defs = DEFS))
        }
        val input = File.createTempFile("books", ".json").apply { deleteOnExit(); writeText(JsonArray(cases.map(::JsonPrimitive)).toString()) }
        val script = """
            import { readFileSync } from 'node:fs';
            import { validateBook } from '${File(root, "site/book/format.js").toURI()}';
            const books = JSON.parse(readFileSync(process.argv[1], 'utf8'));
            process.stdout.write(JSON.stringify(books.map((b) => validateBook(JSON.parse(b)).length === 0)));
        """.trimIndent()
        val process = ProcessBuilder(node, "--input-type=module", "-e", script, input.absolutePath).start()
        val out = process.inputStream.bufferedReader().readText()
        val err = process.errorStream.bufferedReader().readText()
        assertTrue("node did not finish", process.waitFor(60, TimeUnit.SECONDS))
        assertEquals(err, 0, process.exitValue())
        val js = Json.parseToJsonElement(out) as JsonArray
        assertEquals(cases.size, js.size)
        cases.forEachIndexed { i, case ->
            val kotlin = try { readBook(case); true } catch (e: SerializationException) { false } catch (e: IllegalArgumentException) { false }
            assertEquals("case $i: ${case.take(300)}", (js[i] as JsonPrimitive).content.toBoolean(), kotlin)
        }
    }

    // --- helpers ---------------------------------------------------------------------------------

    private fun q(s: String) = JsonPrimitive(s).toString()

    private fun group(clip: String) = """{"t":"group","clip":${q(clip)},"items":[$RECT]}"""

    private fun use(ref: String, extra: String = "") = """{"t":"use","ref":${q(ref)}$extra}"""

    /** Symbols s1 .. s[n], each using the next, the last drawing a rect: a use of s1 reaches n deep. */
    private fun chain(n: Int) = (1..n).joinToString(",", "{", "}") { i ->
        """"s$i":{"items":[${if (i < n) use("s${i + 1}") else RECT}]}"""
    }

    /** A row of 150 leaves: one use of it expands to 300 items. */
    private fun rows() = """{"leaf":{"items":[$RECT]},"row":{"items":[${List(150) { use("leaf") }.joinToString(",")}]}}"""

    private fun book(
        items: List<String>,
        symbols: String? = null,
        format: Int = 2,
        fonts: String = """{"text":"book_text"}""",
        defs: String? = null,
    ) = """{"format":$format,"template":"t","title":"T","fileName":"T.pdf","size":{"w":595,"h":842},"fonts":$fonts""" +
        (defs?.let { ""","defs":$it""" } ?: "") +
        ""","pages":[{"label":"p","items":[${items.joinToString(",")}]}]""" +
        (symbols?.let { ""","symbols":$it""" } ?: "") + "}"

    /** Reads [text], which must be refused; returns why. */
    private fun refusal(text: String, fontKeys: Set<String> = BookFonts.FILES.keys): String {
        try {
            readBook(text, fontKeys)
        } catch (expected: SerializationException) {
            return expected.message.orEmpty()
        } catch (expected: IllegalArgumentException) {
            return expected.message.orEmpty()   // kotlinx.serialization reports some shape errors this way
        }
        fail("read a book it should have refused: ${text.take(300)}")
        error("unreachable")
    }

    /**
     * [got] carries everything [want] does. Numbers agree to a float's precision (the Kotlin model
     * holds Floats), and a number the model defaults to 0 may be left out when written again.
     */
    private fun assertSameJson(want: JsonElement, got: JsonElement?, at: String) {
        when (want) {
            is JsonObject -> {
                val g = got as? JsonObject ?: return fail("$at: $got is not an object")
                assertEquals("$at: keys it gained", emptySet<String>(), g.keys - want.keys)
                for ((k, v) in want) {
                    if (g[k] == null && v is JsonPrimitive && !v.isString && v.doubleOrNull == 0.0) continue
                    assertSameJson(v, g[k], "$at.$k")
                }
            }
            is JsonArray -> {
                val g = got as? JsonArray ?: return fail("$at: $got is not an array")
                assertEquals("$at: length", want.size, g.size)
                want.forEachIndexed { i, v -> assertSameJson(v, g[i], "$at[$i]") }
            }
            is JsonPrimitive -> {
                val g = got as? JsonPrimitive ?: return fail("$at: lost")
                val a = want.doubleOrNull.takeIf { !want.isString }
                val b = g.doubleOrNull.takeIf { !g.isString }
                if (a != null && b != null) assertTrue("$at: $a became $b", abs(a - b) <= 1e-4 * max(1.0, abs(a)))
                else assertEquals(at, want, g)
            }
        }
    }

    private fun nodeOrSkip(): String {
        val node = if (System.getProperty("os.name").startsWith("Windows")) "node.exe" else "node"
        val available = try {
            ProcessBuilder(node, "--version").start().waitFor(10, TimeUnit.SECONDS)
        } catch (e: Exception) {
            false
        }
        if (System.getenv("FTREE_REQUIRE_NODE") == "1") assertTrue("FTREE_REQUIRE_NODE is set and node is not on the path", available)
        else assumeTrue("node is not on the path", available)
        return node
    }

    private companion object {
        const val RECT = """{"t":"rect","x":0,"y":0,"w":1,"h":1,"fill":"#f2b84b"}"""

        const val DEFS = """{"sheen":{"type":"linear","x1":0,"y1":0,"x2":1,"y2":0,"stops":[[0,"#f2b84b",1],[1,"#b5562a",1]]},""" +
            """"glow":{"type":"radial","units":"item","cx":0,"cy":0,"r":1,"stops":[[0,"#f2b84b",1],[1,"#f2b84b",0]]}}"""

        /** format.test.mjs's clips, both ways. */
        val GOOD_CLIPS = listOf("M0 0 L10 0 L10 10 Z", "M0 0 H10 V10 H0 Z", "M0 0 L10 0 10 10Z", "M0 0 Q5 -5 10 0 C10 5 5 10 0 10 Z")
        val BAD_CLIPS = listOf(
            "", "   ", "m0 0 l10 0 z", "M0 0 A5 5 0 0 1 10 10", "L10 10 Z", "e", "M0 0", "M0 0 Z", "M0 0 L10 0 Z",
            "M0 0 L10 0 L10 Z", "M0 0 H Z", "M0 0 C1 1 2 2 Z", "M0 0 L10 0 L10 10 Z 5", "M0 0 L1e999 0 L0 1 Z",
            "M0 0 L10 0 L10 10 X", "M0 0 L+10 0 L10 10 Z", "M0 0 L10 0 L10 10 Z\" onload=\"x",
        )
    }
}
