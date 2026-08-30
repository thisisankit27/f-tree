package com.vibethroughcode.ftree.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.exifinterface.media.ExifInterface
import android.graphics.Matrix
import java.io.File
import java.io.InputStream
import java.util.UUID
import kotlin.math.max
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Photos, kept inside the app's own storage.
 *
 * A picked image is *copied* rather than referenced. A content URI granted by the photo picker is
 * revoked the moment the app restarts, and a file path in the gallery can be moved or deleted by
 * anything, so either would leave the tree full of pictures that silently stop loading. The
 * database records only the file name, never a path, so the reference survives a reinstall or a
 * restore onto a different device.
 *
 * Images are downscaled on the way in: a family of a thousand should not carry a thousand
 * camera-resolution originals, and nothing here is ever shown larger than a phone screen.
 */
class PhotoStore(private val context: Context) {

    private val directory: File
        get() = File(context.filesDir, DIRECTORY).apply { mkdirs() }

    fun file(photoId: String): File = File(directory, photoId)

    fun exists(photoId: String?): Boolean =
        photoId != null && file(photoId).exists()

    /** Copies and downscales a picked image. Returns the new photo id, or null if unreadable. */
    suspend fun save(source: Uri): String? = withContext(Dispatchers.IO) {
        runCatching {
            val bytes = context.contentResolver.openInputStream(source)?.use { it.readBytes() }
                ?: return@runCatching null
            val bitmap = decodeScaled(bytes) ?: return@runCatching null
            val oriented = context.contentResolver.openInputStream(source)?.use { orient(bitmap, it) }
                ?: bitmap
            write(oriented)
        }.getOrNull()
    }

    /**
     * Stores bytes that already are an image — used when importing a tree that carries photos.
     *
     * Downscaled by the same rule as a picked image: an export made by someone whose phone takes
     * enormous photos should not be able to bloat this device's storage.
     */
    suspend fun saveBytes(bytes: ByteArray, preferredId: String? = null): String? =
        withContext(Dispatchers.IO) {
            runCatching {
                val bitmap = decodeScaled(bytes) ?: return@runCatching null
                write(bitmap, preferredId)
            }.getOrNull()
        }

    suspend fun delete(photoId: String?) = withContext(Dispatchers.IO) {
        if (photoId != null) file(photoId).delete()
        Unit
    }

    /** Photo ids with no file behind them, so a caller can tell what an export will be missing. */
    fun missing(photoIds: Collection<String>): List<String> = photoIds.filterNot { exists(it) }

    private fun write(bitmap: Bitmap, preferredId: String? = null): String {
        val id = preferredId ?: "${UUID.randomUUID()}.jpg"
        file(id).outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, QUALITY, it) }
        return id
    }

    /**
     * Decodes at roughly the size we intend to keep rather than decoding full size and shrinking,
     * so a 50-megapixel photo never has to fit in memory at all.
     */
    private fun decodeScaled(bytes: ByteArray): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)

        val longest = max(bounds.outWidth, bounds.outHeight)
        var sample = 1
        while (longest / sample > MAX_EDGE * 2) sample *= 2

        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return null

        val edge = max(decoded.width, decoded.height)
        if (edge <= MAX_EDGE) return decoded
        val ratio = MAX_EDGE.toFloat() / edge
        return Bitmap.createScaledBitmap(
            decoded,
            (decoded.width * ratio).toInt().coerceAtLeast(1),
            (decoded.height * ratio).toInt().coerceAtLeast(1),
            true,
        )
    }

    /** Phones record rotation in EXIF rather than in the pixels; without this, faces come in sideways. */
    private fun orient(bitmap: Bitmap, stream: InputStream): Bitmap {
        val degrees = when (ExifInterface(stream).getAttributeInt(
            ExifInterface.TAG_ORIENTATION,
            ExifInterface.ORIENTATION_NORMAL,
        )) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> return bitmap
        }
        val matrix = Matrix().apply { postRotate(degrees) }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }

    companion object {
        const val DIRECTORY = "photos"
        private const val MAX_EDGE = 1024
        private const val QUALITY = 85
    }
}
