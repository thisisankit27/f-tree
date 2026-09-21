package com.vibethroughcode.ftree.book

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vibethroughcode.ftree.FTreeApplication
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import kotlin.math.abs

/**
 * Book format 2 (#246) painted by the real painter onto the real PdfDocument: the conformance book
 * `site/book/golden/format2-conformance.json` (staged into the test APK's assets by
 * `app/build.gradle.kts`), the same file `format.test.mjs` paints as SVG.
 *
 * The silhouette is checked by its pixels, because Ankit's rule (2026-09-21) is about what a
 * shadow looks like: a ring casts a ring, an open string casts a line, and shapes that overlap
 * inside one dimmed shadow do not darken where they meet.
 */
@RunWith(AndroidJUnit4::class)
class BookFormat2PdfTest {

    private val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as FTreeApplication
    private val printer = BookPrinter(app, app.container.photoStore)

    private fun conformance(): Book {
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        return readBook(assets.open("format2-conformance.json").bufferedReader().use { it.readText() })
    }

    private fun portrait(): Bitmap = Bitmap.createBitmap(200, 200, Bitmap.Config.ARGB_8888).apply {
        eraseColor(Color.rgb(90, 120, 160))
        setHasAlpha(false)
    }

    /** One page through the painter, at [scale] pixels to the point, on white as the PDF is. */
    private fun render(book: Book, page: Int, scale: Float = 1f, painter: BookPainter = BookPainter(printer.fonts) { portrait() }): Bitmap =
        Bitmap.createBitmap((book.size.w * scale).toInt(), (book.size.h * scale).toInt(), Bitmap.Config.ARGB_8888).also {
            it.eraseColor(Color.WHITE)
            val canvas = Canvas(it)
            canvas.scale(scale, scale)
            painter.paint(canvas, book, page)
        }

    @Test
    fun theConformanceBookMakesAnA4PdfThatLooksLikeItsPreview() = runBlocking {
        val book = conformance()
        val photos = book.photos.associate { it.id to portrait() }
        val file = File(app.cacheDir, "book-format2-test.pdf")
        file.outputStream().use { printer.writePdf(book, photos, it) }

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
                        val fromPdf = Bitmap.createBitmap(page.width, page.height, Bitmap.Config.ARGB_8888)
                        fromPdf.eraseColor(Color.WHITE)
                        page.render(fromPdf, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                        val fromPainter = render(book, i, painter = BookPainter(printer.fonts) { photos[it] })
                        save(fromPdf, "format2-page-$i.png")
                        val diff = meanDifference(fromPdf, fromPainter)
                        assertTrue("page ${i + 1} differs from its preview by $diff", diff < 6.0)
                    }
                }
            }
        }
    }

    @Test
    fun aSilhouetteIsTheSameShapeInOneColourAndNeverDarkensWhereItOverlaps() {
        val book = conformance()
        val page = 3   // "The same shape, offset": the keepsake's shadow alone, at tf [1.5 0 0 1.5 152 300]
        assertEquals("The same shape, offset", book.pages[page].label)
        val s = 2f
        val bitmap = render(book, page, s)
        save(bitmap, "format2-silhouette.png")
        fun at(x: Float, y: Float) = bitmap.getPixel((x * s).toInt(), (y * s).toInt())
        fun local(lx: Float, ly: Float) = at(152f + 1.5f * lx, 300f + 1.5f * ly)

        val paper = Color.rgb(0xf6, 0xec, 0xda)
        // #2a1a33 at 0.4 over the paper, drawn once.
        val shadow = Color.rgb(
            (0xf6 * 0.6 + 0x2a * 0.4).toInt(), (0xec * 0.6 + 0x1a * 0.4).toInt(), (0xda * 0.6 + 0x33 * 0.4).toInt(),
        )

        // The ring (circle at 110,0, r 18, stroke 3, no fill) casts a ring, not a disc.
        assertNear("the ring's middle is paper", paper, local(110f, 0f))
        assertNear("the ring's rim is shadow", shadow, local(128f, 0f))

        // The open string (M0 0 C20 -30 50 30 80 0, stroke only) casts a line: its stroke is shadow
        // and the lobe between the curve and its chord stays paper.
        assertNear("the string's line is shadow", shadow, local(16.72f, -8.44f))
        assertNear("the string is not filled", paper, local(16.72f, -3f))

        // The disc (circle at 160,0, r 16) and the tile (164..194 by -12..12) overlap; the use's op
        // is one layer, so the overlap is exactly as dark as either alone.
        val discOnly = local(150f, 0f)
        val both = local(170f, 0f)
        val tileOnly = local(188f, 0f)
        assertNear("the disc is shadow", shadow, discOnly)
        assertNear("the tile is shadow", shadow, tileOnly)
        assertNear("the overlap does not darken", discOnly, both)
    }

    @Test
    fun aSilhouetteRecoloursGradientsAndNestedUsesAndAClipCutsInsideItsTransform() {
        val book = readBook(
            """
            {"format":2,"template":"t","title":"T","fileName":"T.pdf","size":{"w":595,"h":842},"fonts":{"text":"book_text"},
             "defs":{"sheen":{"type":"linear","x1":0,"y1":0,"x2":80,"y2":0,"stops":[[0,"#f2b84b",1],[1,"#b5562a",1]]}},
             "symbols":{
               "bead":{"items":[{"t":"circle","cx":40,"cy":40,"r":40,"fill":{"ref":"sheen"}}]},
               "pair":{"items":[{"t":"use","ref":"bead","fill":"#3a8a7a"},{"t":"use","ref":"bead","tf":[1,0,0,1,100,0]}]}},
             "pages":[{"label":"p","items":[
               {"t":"rect","x":0,"y":0,"w":595,"h":842,"fill":"#ffffff"},
               {"t":"use","ref":"pair","tf":[1,0,0,1,100,100],"fill":"#17122e"},
               {"t":"group","tf":[2,0,0,2,100,400],"clip":"M0 0 H50 V50 H0 Z","items":[
                 {"t":"rect","x":-100,"y":-100,"w":400,"h":400,"fill":"#b5562a"}]}]}]}
            """.trimIndent(),
        )
        val bitmap = render(book, 0)
        val ink = Color.rgb(0x17, 0x12, 0x2e)
        // Both beads are gradient-filled; the first one's own use also asked for teal. Both take the
        // outer silhouette's one colour.
        assertNear("a nested use's own fill gives way to the outer one", ink, bitmap.getPixel(140, 140))
        assertNear("a gradient fill becomes the silhouette's colour", ink, bitmap.getPixel(240, 140))
        // The clip is a 50pt square in the group's own coordinates, so 100pt on the page.
        val terracotta = Color.rgb(0xb5, 0x56, 0x2a)
        assertNear("inside the clip", terracotta, bitmap.getPixel(190, 490))
        assertNear("outside the clip, past its transformed edge", Color.WHITE, bitmap.getPixel(210, 490))
        assertNear("outside the clip, above it", Color.WHITE, bitmap.getPixel(150, 390))
    }

    @Test
    fun aSymbolDrawnManyTimesIsParsedOnce() {
        val book = conformance()
        val page = 1   // "The lamps are one drawing": the diya, drawn seven times, directly and through lamp-pair
        val painter = BookPainter(printer.fonts) { null }
        render(book, page, painter = painter)

        val distinct = mutableSetOf<String>()
        var drawn = 0
        fun walk(items: List<Item>) {
            for (it in items) when (it) {
                is Item.Path -> if (it.d.isNotEmpty()) { distinct += it.d; drawn++ }
                is Item.Group -> { it.clip?.let { clip -> distinct += clip; drawn++ }; walk(it.items) }
                is Item.Use -> walk(book.symbols.getValue(it.ref).items)
                else -> Unit
            }
        }
        walk(book.pages[page].items)
        assertTrue("the page draws its paths many times over: $drawn", drawn > distinct.size * 3)
        assertEquals(distinct.size, painter.pathsParsed)
        // A second paint of the same page parses nothing new.
        render(book, page, painter = painter)
        assertEquals(distinct.size, painter.pathsParsed)
    }

    private fun assertNear(what: String, want: Int, got: Int, tolerance: Int = 8) {
        val far = abs(Color.red(want) - Color.red(got)) > tolerance ||
            abs(Color.green(want) - Color.green(got)) > tolerance ||
            abs(Color.blue(want) - Color.blue(got)) > tolerance
        assertTrue("$what: wanted #%06x, got #%06x".format(want and 0xFFFFFF, got and 0xFFFFFF), !far)
    }

    /** Mean absolute difference per channel, 0-255. Anti-aliasing alone stays well under 6. */
    private fun meanDifference(a: Bitmap, b: Bitmap): Double {
        var total = 0L
        var n = 0L
        for (y in 0 until a.height step 3) for (x in 0 until a.width step 3) {
            val p = a.getPixel(x, y)
            val q = b.getPixel(x, y)
            total += abs(Color.red(p) - Color.red(q)) + abs(Color.green(p) - Color.green(q)) + abs(Color.blue(p) - Color.blue(q))
            n += 3
        }
        return total.toDouble() / n
    }

    /** Kept for a human to look at: `adb pull` the files from the app's external files dir. */
    private fun save(bitmap: Bitmap, name: String) {
        val dir = app.getExternalFilesDir(null) ?: return
        File(dir, name).outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
