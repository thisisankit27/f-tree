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
import kotlin.math.min
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** The square a picked photograph is cut down to, in pixels of the source image. */
data class SquareCrop(val x: Int, val y: Int, val size: Int)

/**
 * Photos, kept inside the app's own storage.
 *
 * A picked image is *copied* rather than referenced. A content URI granted by the photo picker is
 * revoked the moment the app restarts, and a file path in the gallery can be moved or deleted by
 * anything, so either would leave the tree full of pictures that silently stop loading. The
 * database records only the file name, never a path, so the reference survives a reinstall or a
 * restore onto a different device.
 *
 * Everything stored here is small on purpose. A photograph is only ever shown inside a circle — in
 * a list row, on a person's page, on a chart card — so it is squared and cut to [STORED_EDGE] on
 * the way in. A face at 512px is sharper than any of those circles can show even on a 4x screen,
 * and a family of a thousand then costs tens of megabytes rather than gigabytes.
 */
class PhotoStore(private val context: Context) {

    private val directory: File
        get() = File(context.filesDir, DIRECTORY).apply { mkdirs() }

    fun file(photoId: String): File = File(directory, photoId)

    fun exists(photoId: String?): Boolean =
        photoId != null && file(photoId).exists()

    /**
     * Reads a picked image at a size fit for choosing a crop from.
     *
     * Larger than what is finally kept, because the reader can zoom in before cutting and cutting a
     * quarter of a 512px picture would keep 256. Still bounded, so an enormous original never has
     * to fit in memory whole.
     */
    suspend fun decodeForCrop(source: Uri): Bitmap? = withContext(Dispatchers.IO) {
        runCatching {
            val bytes = context.contentResolver.openInputStream(source)?.use { it.readBytes() }
                ?: return@runCatching null
            val bitmap = decodeScaled(bytes, CROP_EDGE) ?: return@runCatching null
            orient(bitmap, bytes)
        }.getOrNull()
    }

    /**
     * Writes the square the reader framed, scaled to [STORED_EDGE].
     *
     * The circle is a matter of display, not of storage: a round image would have to be a PNG with
     * an alpha channel, several times the size of the JPEG, to save a shape that every place that
     * shows it already draws for itself.
     */
    suspend fun saveCrop(bitmap: Bitmap, crop: SquareCrop): String? = withContext(Dispatchers.IO) {
        runCatching {
            val x = crop.x.coerceIn(0, max(0, bitmap.width - 1))
            val y = crop.y.coerceIn(0, max(0, bitmap.height - 1))
            val size = crop.size.coerceAtMost(min(bitmap.width - x, bitmap.height - y))
            if (size <= 0) return@runCatching null

            val square = Bitmap.createBitmap(bitmap, x, y, size, size)
            val scaled = if (size <= STORED_EDGE) square else {
                Bitmap.createScaledBitmap(square, STORED_EDGE, STORED_EDGE, true)
            }
            write(scaled)
        }.getOrNull()
    }

    /**
     * Stores bytes that already are an image — used when importing a tree that carries photos.
     *
     * Not cropped: nobody is at the phone to frame somebody else's photograph, and squaring it
     * blindly would be as likely to cut off a head as to centre one. It is squared where it is
     * drawn instead, which is reversible.
     */
    suspend fun saveBytes(bytes: ByteArray, preferredId: String? = null): String? =
        withContext(Dispatchers.IO) {
            runCatching {
                val bitmap = decodeScaled(bytes, STORED_EDGE) ?: return@runCatching null
                write(bitmap, preferredId)
            }.getOrNull()
        }

    /**
     * A small square copy for the chart, which may be drawing hundreds of faces at once.
     *
     * Decoded at the size it will be drawn and in [Bitmap.Config.RGB_565], so one face costs about
     * eighteen kilobytes rather than the megabyte its stored file would. At the size a chart card
     * is, the missing alpha channel and the shallower colour are invisible.
     */
    suspend fun thumbnail(photoId: String, edgePx: Int): Bitmap? = withContext(Dispatchers.IO) {
        runCatching {
            val path = file(photoId).takeIf { it.exists() }?.absolutePath ?: return@runCatching null

            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeFile(path, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return@runCatching null

            val shortest = min(bounds.outWidth, bounds.outHeight)
            var sample = 1
            while (shortest / (sample * 2) >= edgePx) sample *= 2

            val options = BitmapFactory.Options().apply {
                inSampleSize = sample
                inPreferredConfig = Bitmap.Config.RGB_565
            }
            BitmapFactory.decodeFile(path, options)
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
    private fun decodeScaled(bytes: ByteArray, maxEdge: Int): Bitmap? {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)

        val longest = max(bounds.outWidth, bounds.outHeight)
        var sample = 1
        while (longest / sample > maxEdge * 2) sample *= 2

        val options = BitmapFactory.Options().apply { inSampleSize = sample }
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return null

        val edge = max(decoded.width, decoded.height)
        if (edge <= maxEdge) return decoded
        val ratio = maxEdge.toFloat() / edge
        return Bitmap.createScaledBitmap(
            decoded,
            (decoded.width * ratio).toInt().coerceAtLeast(1),
            (decoded.height * ratio).toInt().coerceAtLeast(1),
            true,
        )
    }

    /** Phones record rotation in EXIF rather than in the pixels; without this, faces come in sideways. */
    private fun orient(bitmap: Bitmap, bytes: ByteArray): Bitmap =
        bytes.inputStream().use { orient(bitmap, it) }

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

        /** What a photograph is kept at, which is all any circle in this app can show. */
        const val STORED_EDGE = 512

        /** What a photograph is *offered* at while the reader frames it. */
        const val CROP_EDGE = 1440

        private const val QUALITY = 85
    }
}
