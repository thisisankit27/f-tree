package com.vibethroughcode.ftree.transfer

import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vibethroughcode.ftree.FTreeApplication
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * What leaves the app when a relationship is shared as a picture.
 *
 * The type is the point. A chat app handed `image/png` shows the message beside it; handed a
 * document it drops the message, which is what sending a `.ftree` turned out to do.
 */
@RunWith(AndroidJUnit4::class)
class CardShareTest {

    private val app: FTreeApplication
        get() = InstrumentationRegistry.getInstrumentation()
            .targetContext.applicationContext as FTreeApplication

    private fun card(): Bitmap = Bitmap.createBitmap(1080, 1350, Bitmap.Config.ARGB_8888)

    @Test
    fun thePictureIsWrittenWhereAnotherAppCanReadIt() = runBlocking {
        val uri = app.container.cardShare.write(card(), "Meena")

        val bytes = app.contentResolver.openInputStream(uri)!!.use { it.readBytes() }
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
        assertEquals(1080, decoded.width)
        assertEquals(1350, decoded.height)
        assertTrue("named after who it is about: $uri", uri.toString().endsWith("Meena.png"))
    }

    @Test
    fun theLastPictureGoesWhenTheNextIsMade() = runBlocking {
        app.container.cardShare.write(card(), "Meena")
        app.container.cardShare.write(card(), "Vinod Kumar")

        val directory = java.io.File(app.cacheDir, "shared")
        assertEquals(listOf("Vinod-Kumar.png"), directory.list()!!.toList())
    }

    @Test
    fun theIntentIsAPictureWithSomethingSaidBesideIt() {
        val uri = Uri.parse("content://example/card.png")
        val caption = "Meena is Ankit Kumar's aunt."
        val intent = sendCardIntent(uri, caption)

        assertEquals(Intent.ACTION_SEND, intent.action)
        // Not the document type the branch share uses: that is the whole difference.
        assertEquals("image/png", intent.type)
        assertEquals(uri, intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java))
        assertEquals(caption, intent.getStringExtra(Intent.EXTRA_TEXT))
        assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
    }

    @Test
    fun aNameWithNothingUsableInItStillMakesAFile() = runBlocking {
        val uri = app.container.cardShare.write(card(), "   ")
        assertTrue(uri.toString().endsWith("relationship.png"))
    }
}
