package com.vibethroughcode.ftree.book

import com.vibethroughcode.ftree.transfer.ExportJson
import com.vibethroughcode.ftree.transfer.TreeDocument
import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File
import java.util.concurrent.TimeUnit
import java.util.zip.ZipInputStream

/**
 * The Kotlin reading of the Book format, held to books the real composer made.
 *
 * `site/book/golden/sample-heirloom.json` is written by `site/book/book.test.mjs`, so a change to
 * what the composer writes that this app cannot read fails here rather than on somebody's phone.
 * The last test goes one further and has the composer lay out the book from a document encoded by
 * the app's own exporter types - the exact bytes Android hands the WebView.
 */
class BookFormatTest {

    private fun root(): File {
        var dir = File(System.getProperty("user.dir"))
        while (!File(dir, "settings.gradle.kts").exists()) dir = dir.parentFile ?: error("no repository root")
        return dir
    }

    private fun golden() = File(root(), "site/book/golden/sample-heirloom.json").readText()

    @Test
    fun `the golden book reads, every page and every item`() {
        val book = readBook(golden())
        assertEquals(Book.FORMAT, book.format)
        assertEquals(PageSize(595, 842), book.size)
        assertEquals("Cover", book.pages.first().label)
        assertEquals("Is someone missing?", book.pages.last().label)
        val kinds = mutableSetOf<String>()
        fun walk(items: List<Item>): Unit = items.forEach {
            kinds += it::class.simpleName!!
            if (it is Item.Group) walk(it.items)
        }
        book.pages.forEach { walk(it.items) }
        // Every kind of item the format has turns up in a real book, so every one is proved to parse.
        assertEquals(setOf("Rect", "Circle", "Path", "Text", "Image", "Group"), kinds)
        assertTrue(book.photos.isNotEmpty())
        for ((_, g) in book.defs) assertTrue(g.stops.size >= 2)
    }

    @Test
    fun `a book read and written again is the same book`() {
        val book = readBook(golden())
        val again = readBook(BookJson.encodeToString(Book.serializer(), book))
        assertEquals(book, again)
    }

    @Test
    fun `a book from a newer composer is refused, not drawn approximately`() {
        val newer = golden().replaceFirst("\"format\":1", "\"format\":3")
        assertRefused(newer)
    }

    @Test
    fun `an item this app does not know is refused`() {
        assertRefused(golden().replaceFirst("\"t\":\"rect\"", "\"t\":\"hologram\""))
    }

    @Test
    fun `an unknown key is refused`() {
        assertRefused(golden().replaceFirst("\"t\":\"rect\",", "\"t\":\"rect\",\"blend\":\"screen\","))
    }

    @Test
    fun `a colour that is not rrggbb is refused`() {
        val book = golden()
        val first = Regex("\"fill\":\"(#[0-9a-f]{6})\"").find(book)!!.groupValues[1]
        assertRefused(book.replaceFirst("\"fill\":\"$first\"", "\"fill\":\"red\""))
    }

    @Test
    fun `the composer lays out a book from the app's own exported document`() {
        val node = nodeOrSkip()
        val document = sampleDocument()
        val docJson = ExportJson.encodeToString(TreeDocument.serializer(), document)
        val input = File.createTempFile("book-input", ".json").apply { deleteOnExit(); writeText(docJson) }
        val script = """
            import { readFileSync } from 'node:fs';
            import { composeBook } from '${File(root(), "site/book/compose.js").toURI()}';
            const doc = JSON.parse(readFileSync(process.argv[1], 'utf8'));
            const template = JSON.parse(readFileSync('${File(root(), "site/book/templates/heirloom.json").absolutePath}', 'utf8'));
            process.stdout.write(JSON.stringify(composeBook(doc, { now: '2026-09-15' }, template)));
        """.trimIndent()
        val process = ProcessBuilder(node, "--input-type=module", "-e", script, input.absolutePath).redirectErrorStream(false).start()
        val out = process.inputStream.bufferedReader().readText()
        val err = process.errorStream.bufferedReader().readText()
        assertTrue("node did not finish", process.waitFor(60, TimeUnit.SECONDS))
        assertEquals(err, 0, process.exitValue())
        val book = readBook(out)
        // The desktop reads the very same archive through site/playground/archive.js; composing both
        // must give the same book, byte for byte, which is the point of one composer.
        assertEquals(readBook(golden()), book)
    }

    private fun sampleDocument(): TreeDocument {
        ZipInputStream(File(root(), "site/playground/sample-family.ftree").inputStream().buffered()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                if (entry.name == TreeDocument.ENTRY_JSON) return ExportJson.decodeFromString(TreeDocument.serializer(), String(zip.readBytes()))
            }
        }
        error("no tree.json in the sample")
    }

    private fun assertRefused(text: String) {
        try {
            readBook(text)
            fail("read a book it should have refused")
        } catch (expected: SerializationException) {
            // refused, as it should be
        } catch (expected: IllegalArgumentException) {
            // kotlinx.serialization reports some shape errors this way
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
}
