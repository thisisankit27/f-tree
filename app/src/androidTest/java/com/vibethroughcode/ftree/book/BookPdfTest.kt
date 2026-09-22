package com.vibethroughcode.ftree.book

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.webkit.WebResourceRequest
import android.webkit.WebView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.transfer.ExportJson
import com.vibethroughcode.ftree.transfer.PersonRecord
import com.vibethroughcode.ftree.transfer.RelationshipRecord
import com.vibethroughcode.ftree.transfer.TreeDocument
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/**
 * The family book on a real device: the real WebView lays it out, the real painter writes the PDF,
 * and the platform's own PdfRenderer reads it back.
 *
 * What it proves, in the order a reader would care:
 *  - the book is laid out on the phone at all (the WebView runs the staged composer);
 *  - the PDF has the pages the composer made, each A4, and looks like the preview it came from;
 *  - the text is real embedded TrueType, with Devanagari in the font, not Type3 outlines or boxes;
 *  - a family with photographs stays within what a chat app will carry;
 *  - the WebView cannot reach anything but the app's own assets.
 */
@RunWith(AndroidJUnit4::class)
class BookPdfTest {

    private val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as FTreeApplication
    private val composer = BookComposer(app)
    private val printer = BookPrinter(app, app.container.photoStore)

    @After
    fun close() = composer.close()

    /** Latin and Devanagari names, the departed, somebody nobody named, and photographs. */
    private fun document(): TreeDocument {
        fun p(id: String, name: String?, gender: String, birth: String?, death: String? = null, photo: Boolean = false) =
            PersonRecord(id = id, name = name, gender = gender, birthDate = birth, deathDate = death, deceased = death != null,
                photo = if (photo) "photos/$id" else null, notes = null, origins = emptyList())
        val people = listOf(
            p("a", "रामप्रसाद शर्मा", "MALE", "1921-03-14", "1994-11-02", photo = true),
            p("b", "सावित्री देवी", "FEMALE", "1926", "2009-01-20"),
            p("c", "Vinod Sharma", "MALE", "1948-07-09", "2017-05-11", photo = true),
            p("d", "Krishna Sharma", "FEMALE", "1952-02-01", photo = true),
            p("e", "क्षितिज त्रिपाठी", "MALE", "1978"),
            p("f", "Aarav Sharma", "MALE", "1990-04-17", photo = true),
            p("g", null, "UNSPECIFIED", null),
            p("h", "Isha Sharma", "FEMALE", "2015-03-08"),
        )
        var n = 0
        fun r(from: String, to: String, type: String) = RelationshipRecord(id = "r${n++}", from = from, to = to, type = type, subtype = null)
        val relationships = listOf(
            r("a", "b", "SPOUSE"), r("a", "c", "PARENT"), r("b", "c", "PARENT"), r("a", "e", "PARENT"),
            r("c", "d", "SPOUSE"), r("c", "f", "PARENT"), r("d", "f", "PARENT"),
            r("f", "g", "SPOUSE"), r("f", "h", "PARENT"), r("g", "h", "PARENT"),
        )
        return TreeDocument(exportedAt = "2026-09-15T00:00:00Z", sourceTreeId = "test", people = people, relationships = relationships)
    }

    private fun input(templateId: String = "heirloom"): String = runBlocking {
        val template = BookTemplates(app).offered(java.time.LocalDate.of(2026, 9, 15)).first { it.id == templateId }.json
        buildJsonObject {
            put("doc", ExportJson.parseToJsonElement(ExportJson.encodeToString(TreeDocument.serializer(), document())))
            putJsonObject("options") { put("now", "2026-09-15") }
            put("template", template)
            putJsonObject("allowance") {}
        }.toString()
    }

    @Test
    fun makesAnA4PdfThatLooksLikeItsPreview() = runBlocking {
        val started = System.nanoTime()
        val book = composer.compose(input())
        val composed = (System.nanoTime() - started) / 1_000_000
        assertEquals("Cover", book.pages.first().label)
        assertTrue("photographs asked for", book.photos.isNotEmpty())

        val photos = book.photos.associate { it.id to portrait() }
        val file = File(app.cacheDir, "book-test.pdf")
        file.outputStream().use { printer.writePdf(book, photos, it) }
        val written = (System.nanoTime() - started) / 1_000_000
        android.util.Log.i("BookPdfTest", "composed in $composed ms, written in $written ms, ${file.length()} bytes, ${book.pages.size} pages")

        assertTrue("under the chat-app budget: ${file.length()}", file.length() < 10_000_000)
        val bytes = file.readBytes().toString(Charsets.ISO_8859_1)
        assertTrue("fonts embedded as TrueType", "/FontFile2" in bytes)
        assertTrue("no Type3 outlines", "/Type3" !in bytes)

        ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).use { fd ->
            PdfRenderer(fd).use { pdf ->
                assertEquals(book.pages.size, pdf.pageCount)
                for (i in 0 until pdf.pageCount) {
                    pdf.openPage(i).use { page ->
                        assertEquals(595, page.width)
                        assertEquals(842, page.height)
                        if (i == 0 || book.pages[i].label.startsWith("Generations")) {
                            val fromPdf = Bitmap.createBitmap(page.width, page.height, Bitmap.Config.ARGB_8888)
                            fromPdf.eraseColor(Color.WHITE)
                            page.render(fromPdf, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                            val fromPainter = Bitmap.createBitmap(page.width, page.height, Bitmap.Config.ARGB_8888)
                            fromPainter.eraseColor(Color.WHITE)
                            BookPainter(printer.fonts) { photos[it] }.paint(Canvas(fromPainter), book, i)
                            val diff = meanDifference(fromPdf, fromPainter)
                            save(app, fromPdf, "book-page-$i.png")
                            assertTrue("page ${i + 1} differs from its preview by $diff", diff < 6.0)
                        }
                    }
                }
            }
        }
    }

    @Test
    fun theBookFontsCarryDevanagari() {
        // hasGlyph takes one grapheme cluster at a time - consonants, and the conjuncts that make
        // Devanagari names, each of which the font has to shape into a single glyph.
        val clusters = listOf("श", "र", "म", "क", "ष", "त", "ज", "ञ", "क्ष", "त्र", "ज्ञ", "श्र")
        for (key in listOf("book_text", "book_strong", "book_display", "book_hand")) {
            val paint = Paint().apply { typeface = printer.fonts.getValue(key) }
            for (cluster in clusters) assertTrue("$key: $cluster", paint.hasGlyph(cluster))
        }
    }

    @Test
    fun theDiwaliTemplateComposesToo() = runBlocking {
        val book = composer.compose(input("diwali"))
        assertTrue(book.fileName.endsWith("Diwali Book.pdf"))
        assertTrue(book.pages.size >= 5)
    }

    @Test
    fun theComposerCanReachNothingButTheAppsAssets() {
        InstrumentationRegistry.getInstrumentation().runOnMainSync {
            val view = WebView(app)
            val client = BookWebClient(app) {}
            fun ask(url: String) = client.shouldInterceptRequest(view, request(url))
            assertEquals(404, ask("https://example.com/").statusCode)
            assertEquals(404, ask("http://${BookComposer.HOST}/bookhost/index.html").statusCode)
            assertEquals(404, ask("https://${BookComposer.HOST}/book/policy.json").statusCode)
            assertEquals(404, ask("https://${BookComposer.HOST}/book/site/../../AndroidManifest.xml").statusCode)
            // An asset is served with its content and type; a refusal is an explicit 404.
            val asset = ask("https://${BookComposer.HOST}/book/site/book/compose.js")
            assertTrue(asset.statusCode != 404 && asset.data != null)
            assertEquals("text/javascript", asset.mimeType)
            view.destroy()
        }
    }

    private fun request(url: String) = object : WebResourceRequest {
        override fun getUrl(): Uri = Uri.parse(url)
        override fun isForMainFrame() = false
        override fun isRedirect() = false
        override fun hasGesture() = false
        override fun getMethod() = "GET"
        override fun getRequestHeaders(): Map<String, String> = emptyMap()
    }
}
