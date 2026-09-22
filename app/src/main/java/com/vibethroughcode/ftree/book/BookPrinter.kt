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

    /** The faces of [BookFonts.FILES], loaded from the same files the desktop embeds. */
    val fonts: Map<String, Typeface> by lazy {
        BookFonts.FILES.mapValues { (_, id) -> ResourcesCompat.getFont(context, id) ?: Typeface.DEFAULT }
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
