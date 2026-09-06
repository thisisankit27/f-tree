package com.vibethroughcode.ftree.data

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File

@RunWith(AndroidJUnit4::class)
class PhotoStoreTest {

    private lateinit var store: PhotoStore
    private lateinit var directory: File

    @Before
    fun setUp() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        store = PhotoStore(context)
        directory = File(context.filesDir, PhotoStore.DIRECTORY)
        directory.deleteRecursively()
    }

    @After
    fun tearDown() {
        directory.deleteRecursively()
    }

    private fun jpegBytes(width: Int, height: Int): ByteArray {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        return ByteArrayOutputStream().use {
            bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it)
            it.toByteArray()
        }
    }

    @Test
    fun storingAnImageReturnsAnIdThatResolvesToAFile() = runTest {
        val id = store.saveBytes(jpegBytes(200, 200))

        assertNotNull(id)
        assertTrue(store.exists(id))
        assertTrue(store.file(id!!).length() > 0)
    }

    @Test
    fun aLargeImageIsScaledDownOnTheWayIn() = runTest {
        val id = store.saveBytes(jpegBytes(4000, 3000))!!

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(store.file(id).absolutePath, bounds)

        // A family of a thousand should not be carrying a thousand camera-resolution originals.
        assertTrue(
            "stored at ${bounds.outWidth}x${bounds.outHeight}",
            maxOf(bounds.outWidth, bounds.outHeight) <= PhotoStore.STORED_EDGE,
        )
    }

    /**
     * A framed photograph is kept as the square the reader chose, at the size every circle in the
     * app can actually show. Both halves matter: the wrong square is the wrong face, and the wrong
     * size is a tree that costs gigabytes to hold a few hundred portraits.
     */
    @Test
    fun aFramedPhotoIsKeptAsASquareAtTheStoredSize() = runTest {
        val source = Bitmap.createBitmap(2000, 1200, Bitmap.Config.ARGB_8888)

        val id = store.saveCrop(source, SquareCrop(x = 400, y = 0, size = 1200))!!

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(store.file(id).absolutePath, bounds)
        assertEquals(PhotoStore.STORED_EDGE, bounds.outWidth)
        assertEquals(PhotoStore.STORED_EDGE, bounds.outHeight)
    }

    /** A square smaller than the kept size is left alone rather than blown up into blur. */
    @Test
    fun aSmallFramedPhotoIsNotEnlarged() = runTest {
        val source = Bitmap.createBitmap(300, 300, Bitmap.Config.ARGB_8888)

        val id = store.saveCrop(source, SquareCrop(x = 0, y = 0, size = 300))!!

        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(store.file(id).absolutePath, bounds)
        assertEquals(300, bounds.outWidth)
    }

    /**
     * A square that runs off the edge of the picture is pulled back inside it.
     *
     * Not defensiveness for its own sake: Bitmap.createBitmap throws on an out-of-bounds rectangle,
     * so a pixel of drift after a rotation would be a crash at the moment somebody saves a face.
     */
    @Test
    fun aCropOutsideThePictureIsBroughtBackInsideIt() = runTest {
        val source = Bitmap.createBitmap(400, 400, Bitmap.Config.ARGB_8888)

        val id = store.saveCrop(source, SquareCrop(x = 380, y = 380, size = 400))

        assertNotNull(id)
        assertTrue(store.exists(id))
    }

    /**
     * The chart holds hundreds of faces at once, so it is given small ones.
     *
     * The comparison that matters is against decoding the stored file whole, which is what a naive
     * chart would do: at 512px in ARGB_8888 that is a megabyte per person, and a hundred people on
     * screen would be a hundred megabytes of faces.
     */
    @Test
    fun aThumbnailIsFarCheaperThanTheStoredPhotograph() = runTest {
        val id = store.saveBytes(jpegBytes(1000, 1000))!!

        val thumb = store.thumbnail(id, edgePx = 96)!!

        // Decoding samples by powers of two, so the result lands within a factor of two of the ask.
        assertTrue(
            "thumbnail was ${thumb.width}x${thumb.height}",
            maxOf(thumb.width, thumb.height) <= 96 * 2,
        )
        assertEquals(Bitmap.Config.RGB_565, thumb.config)

        val whole = PhotoStore.STORED_EDGE * PhotoStore.STORED_EDGE * 4
        assertTrue("thumbnail cost ${thumb.byteCount} bytes", thumb.byteCount * 8 < whole)
    }

    @Test
    fun aThumbnailOfSomethingThatIsNotThereIsNothingRatherThanACrash() = runTest {
        assertNull(store.thumbnail("gone.jpg", edgePx = 96))
    }

    @Test
    fun theStoredIdIsAFileNameAndNotAPath() = runTest {
        val id = store.saveBytes(jpegBytes(100, 100))!!

        // A path would break on reinstall or on a restore to another device.
        assertFalse(id.contains('/'))
        assertEquals(id, File(id).name)
    }

    @Test
    fun deletingRemovesTheFile() = runTest {
        val id = store.saveBytes(jpegBytes(100, 100))!!

        store.delete(id)

        assertFalse(store.exists(id))
    }

    @Test
    fun deletingSomethingThatIsNotThereIsHarmless() = runTest {
        store.delete(null)
        store.delete("does-not-exist.jpg")
    }

    @Test
    fun unreadableBytesYieldNothingRatherThanACrash() = runTest {
        assertNull(store.saveBytes("not an image".toByteArray()))
    }

    @Test
    fun missingPhotosAreReportable() = runTest {
        val present = store.saveBytes(jpegBytes(50, 50))!!

        val missing = store.missing(listOf(present, "gone.jpg"))

        assertEquals(listOf("gone.jpg"), missing)
    }

    @Test
    fun anImportedPhotoCanKeepTheIdItArrivedWith() = runTest {
        val id = store.saveBytes(jpegBytes(100, 100), preferredId = "from-an-export.jpg")

        assertEquals("from-an-export.jpg", id)
        assertTrue(store.exists(id))
    }
}
