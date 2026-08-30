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
            maxOf(bounds.outWidth, bounds.outHeight) <= 1024,
        )
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
