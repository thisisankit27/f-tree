package com.vibethroughcode.ftree.transfer

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File

/**
 * Writes a picture of a relationship somewhere another app can read it.
 *
 * The same cache directory and the same provider the branch share uses, for the same reasons: it is
 * a message rather than a document, nobody wants to name it, and the last one goes when the next is
 * made. PNG rather than JPEG because the card is flat colour, a hairline rule and small type — all
 * three of which JPEG blurs at exactly the sizes that matter.
 */
class CardShare(private val context: Context) {

    suspend fun write(bitmap: Bitmap, name: String): Uri = withContext(Dispatchers.IO) {
        val directory = File(context.cacheDir, DIRECTORY)
        directory.deleteRecursively()
        directory.mkdirs()

        val file = File(directory, fileNameFor(name))
        file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        FileProvider.getUriForFile(context, "${context.packageName}.shares", file)
    }

    private fun fileNameFor(name: String): String {
        val stem = name.trim()
            .replace(Regex("[^\\p{L}\\p{N}]+"), "-")
            .trim('-')
            .take(48)
            .ifBlank { "relationship" }
        return "$stem.png"
    }

    private companion object {
        const val DIRECTORY = "shared"
    }
}

/**
 * The intent that carries a picture out of the app.
 *
 * `image/png` rather than a document type, which is the whole reason this exists: a chat app treats
 * a picture as something to say a sentence about and shows the text beside it, where the same app
 * handed a file quietly drops the message.
 */
fun sendCardIntent(uri: Uri, caption: String?): Intent =
    Intent(Intent.ACTION_SEND).apply {
        type = "image/png"
        putExtra(Intent.EXTRA_STREAM, uri)
        caption?.let { putExtra(Intent.EXTRA_TEXT, it) }
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
