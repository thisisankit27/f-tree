package com.vibethroughcode.ftree.ui

import android.graphics.Bitmap
import android.graphics.Color
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.MainActivity
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.ui.person.PersonAvatarTag
import com.vibethroughcode.ftree.ui.person.PersonPhotoCloseTag
import com.vibethroughcode.ftree.ui.person.PersonPhotoDialogTag
import com.vibethroughcode.ftree.ui.person.PersonPhotoImageTag
import com.vibethroughcode.ftree.ui.tree.FamilyChartTag
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream

/** Opening the photograph on somebody's page, and putting it away again. */
@RunWith(AndroidJUnit4::class)
class PhotoViewerTest {

    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    private val app: FTreeApplication
        get() = InstrumentationRegistry.getInstrumentation()
            .targetContext.applicationContext as FTreeApplication

    @Before
    fun seedOneFaceAndOneInitial() {
        app.container.updatePreferences.setEnabled(false)
        app.container.database.clearAllTables()

        runBlocking {
            // A real JPEG through the real store, so the id and the file agree the way they do
            // when somebody picks a photograph.
            val bitmap = Bitmap.createBitmap(300, 300, Bitmap.Config.ARGB_8888).apply {
                eraseColor(Color.rgb(120, 80, 60))
            }
            val bytes = ByteArrayOutputStream()
                .also { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }
                .toByteArray()
            val photoId = app.container.photoStore.saveBytes(bytes)
            assertTrue("the store did not keep the photograph", photoId != null)

            app.container.familyRepository.addPerson(
                Person(name = "Neeru Verma", birthDate = "1966", photoId = photoId)
            )
            app.container.familyRepository.addPerson(Person(name = "Arun Verma", birthDate = "1962"))
        }
        rule.waitUntil(10_000) {
            rule.onAllNodesWithTag(FamilyChartTag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun openPerson(name: String) {
        rule.onNodeWithTag(NavPeopleTag).performClick()
        rule.waitForIdle()
        rule.onNodeWithText(name).performScrollTo().performClick()
        rule.waitForIdle()
    }

    @Test
    fun aPhotographOpensWhenItIsTappedAndCloses() {
        openPerson("Neeru Verma")

        rule.onNodeWithTag(PersonAvatarTag).assertIsDisplayed().performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(PersonPhotoDialogTag).assertIsDisplayed()
        // The picture itself, not merely the scrim it sits on. By tag, because the avatar on the
        // page behind carries the same description — which is right, and is why matching on the
        // description alone found two.
        // Through the unmerged tree: the scrim is clickable, so it merges the picture's semantics
        // into itself — which is what makes a screen reader announce one thing, "photo of Neeru
        // Verma", with one way out, rather than two nodes to hunt through.
        rule.onNodeWithTag(PersonPhotoImageTag, useUnmergedTree = true).assertIsDisplayed()

        rule.onNodeWithTag(PersonPhotoCloseTag).performClick()
        rule.waitForIdle()
        assertTrue(
            "the photograph stayed open after Close",
            rule.onAllNodesWithTag(PersonPhotoDialogTag).fetchSemanticsNodes().isEmpty(),
        )
    }

    @Test
    fun tappingThePictureItselfPutsItAway() {
        openPerson("Neeru Verma")
        rule.onNodeWithTag(PersonAvatarTag).performClick()
        rule.waitForIdle()

        rule.onNodeWithTag(PersonPhotoDialogTag).performClick()
        rule.waitForIdle()
        assertTrue(
            "a tap on the picture should put it away, as it does anywhere else",
            rule.onAllNodesWithTag(PersonPhotoDialogTag).fetchSemanticsNodes().isEmpty(),
        )
    }

    /**
     * Somebody with no photograph has a lettered circle, and it must not offer a gesture that
     * leads to a blank screen.
     */
    @Test
    fun anInitialIsNotSomethingToOpen() {
        openPerson("Arun Verma")

        assertTrue(
            "the lettered circle should not be tappable",
            rule.onAllNodesWithTag(PersonAvatarTag).fetchSemanticsNodes().isEmpty(),
        )
    }
}
