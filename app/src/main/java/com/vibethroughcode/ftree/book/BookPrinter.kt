package com.vibethroughcode.ftree.book

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Picture
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.net.Uri
import androidx.core.content.FileProvider
import androidx.core.content.res.ResourcesCompat
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.PhotoStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File
import java.io.OutputStream
import kotlin.coroutines.coroutineContext

/**
 * Everything between a laid-out [Book] and a file: the fonts, the photographs, the preview, the PDF.
 */
class BookPrinter(private val context: Context, private val photos: PhotoStore) {

    /** The faces of [FONT_FILES], loaded from the same files the desktop embeds. */
    val fonts: Map<String, Typeface> by lazy {
        FONT_FILES.mapValues { (_, id) -> ResourcesCompat.getFont(context, id) ?: Typeface.DEFAULT }
    }

    /**
     * The portraits a book asked for, at the resolution it asked for them. [photoOf] maps a person
     * to their stored photograph. Missing files are simply absent: the portrait keeps its ring.
     */
    suspend fun loadPhotos(book: Book, photoOf: (String) -> String?): Map<String, Bitmap> = withContext(Dispatchers.IO) {
        buildMap {
            for (request in book.photos) {
                coroutineContext.ensureActive()
                val photoId = photoOf(request.id) ?: continue
                photos.printable(photoId, request.px)?.let { put(request.id, it) }
            }
        }
    }

    /** One recorded picture per page, for the preview to draw at any size without repainting. */
    fun pictures(book: Book, photos: Map<String, Bitmap>): List<Picture> {
        val painter = BookPainter(fonts) { photos[it] }
        return book.pages.indices.map { i ->
            Picture().also { picture ->
                val canvas = picture.beginRecording(book.size.w, book.size.h)
                painter.paint(canvas, book, i)
                picture.endRecording()
            }
        }
    }

    /**
     * Writes the PDF. Painted afresh onto each [PdfDocument] page rather than replayed from the
     * preview's pictures, so nothing stands between the painter and the PDF's own vector text.
     */
    suspend fun writePdf(book: Book, photos: Map<String, Bitmap>, out: OutputStream) = withContext(Dispatchers.Default) {
        val painter = BookPainter(fonts) { photos[it] }
        val document = PdfDocument()
        try {
            for (i in book.pages.indices) {
                coroutineContext.ensureActive()
                val page = document.startPage(PdfDocument.PageInfo.Builder(book.size.w, book.size.h, i + 1).create())
                painter.paint(page.canvas, book, i)
                document.finishPage(page)
            }
            withContext(Dispatchers.IO) { document.writeTo(out) }
        } finally {
            document.close()
        }
    }

    /**
     * Writes the book where the share sheet can hand it on - the same directory and provider the
     * relationship card and a shared branch use, cleared first so only the newest file is there.
     * The file keeps the book's own name: a chat app prints it under the thumbnail.
     */
    suspend fun writeForSharing(book: Book, photos: Map<String, Bitmap>): Uri = withContext(Dispatchers.IO) {
        val directory = File(context.cacheDir, SHARED_DIRECTORY)
        directory.deleteRecursively()
        directory.mkdirs()
        val file = File(directory, safeName(book.fileName))
        file.outputStream().use { writePdf(book, photos, it) }
        FileProvider.getUriForFile(context, "${context.packageName}.shares", file)
    }

    companion object {
        private const val SHARED_DIRECTORY = "shared"

        /**
         * The four faces a template may name, by font key, from the same files the desktop embeds.
         * Static instances, not variable fonts: Skia's PDF backend would otherwise write the text as
         * Type3 outlines nobody can select or search (docs/fonts.md).
         *
         * [readBook] refuses a book naming any key not here (#246), so a face this release does not
         * carry is a clear refusal rather than a line of text silently left off the page. Kept here,
         * rather than in `Book.kt`, so that check and the typefaces the painter draws with are one list.
         *
         * There is no Kotlin `FONT_KEYS` constant - this map is one of five places that list the book's
         * font keys and must be kept in step by hand with the other four: `FONT_KEYS` in
         * `site/book/template.js`, `BOOK_FONT_FILES` in `desktop/main.js`, the `@font-face` rules in
         * `site/book/preview.html`, and the tables gathered into `METRICS` in
         * `site/book/metrics/index.js`. `site/book/font-keys.json` plus `font-keys.test.mjs` and
         * `FontKeysTest.kt` fail the build if any of the five disagree.
         */
        val FONT_FILES: Map<String, Int> = mapOf(
            "book_display" to R.font.book_display,
            "book_text" to R.font.book_text,
            "book_strong" to R.font.book_strong,
            "book_hand" to R.font.book_hand,
        )

        /** The composer already strips path characters; this is the belt to its braces. */
        fun safeName(name: String): String =
            name.replace(Regex("[\\\\/:*?\"<>|\\u0000-\\u001f]"), "").trim().ifBlank { "Family Book.pdf" }
                .let { if (it.endsWith(".pdf", ignoreCase = true)) it else "$it.pdf" }
    }
}

/**
 * A PDF is a document, and a chat app drops a document's caption - so the book has to explain
 * itself on its cover, which it does. The text still travels for the apps that keep it.
 */
fun sendBookIntent(uri: Uri, title: String, caption: String): Intent =
    Intent(Intent.ACTION_SEND).apply {
        type = "application/pdf"
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_SUBJECT, title)
        putExtra(Intent.EXTRA_TEXT, caption)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
