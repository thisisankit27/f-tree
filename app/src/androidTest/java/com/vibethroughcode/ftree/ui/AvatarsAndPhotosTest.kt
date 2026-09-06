package com.vibethroughcode.ftree.ui

import android.graphics.Bitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.MainActivity
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.data.RelativeKind
import com.vibethroughcode.ftree.data.SquareCrop
import com.vibethroughcode.ftree.ui.person.CropRequest
import com.vibethroughcode.ftree.ui.person.PhotoCropConfirmTag
import com.vibethroughcode.ftree.ui.person.PhotoCropDialog
import com.vibethroughcode.ftree.ui.settings.SettingsPhotosToggleTag
import com.vibethroughcode.ftree.ui.theme.FTreeTheme
import com.vibethroughcode.ftree.ui.tree.FamilyChartTag
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Faces on the chart, and the framing that puts them there.
 */
@RunWith(AndroidJUnit4::class)
class AvatarsAndPhotosTest {

    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    private val app: FTreeApplication
        get() = InstrumentationRegistry.getInstrumentation()
            .targetContext.applicationContext as FTreeApplication

    private fun seed() {
        app.container.database.clearAllTables()
        runBlocking {
            val parent = Person(name = "Vinod Kumar", birthDate = "1962")
            val child = Person(name = "Ankit Kumar", birthDate = "1990")
            listOf(parent, child).forEach { app.container.familyRepository.addPerson(it) }
            app.container.familyRepository.addRelative(child.id, parent.id, RelativeKind.PARENT)
        }
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(FamilyChartTag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    /**
     * Photographs are on unless the reader says otherwise, and turning them off is a drawing
     * decision rather than a change to the record or to the shape of the chart.
     */
    @Test
    fun photosOnTheChartAreOnByDefaultAndCanBeTurnedOff() {
        app.container.chartPreferences.setPhotosInChart(true)
        seed()

        rule.onNodeWithTag(NavSettingsTag).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(SettingsPhotosToggleTag).fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag(SettingsPhotosToggleTag).assertIsOn()

        // The whole row is the target, not the 32dp switch at the far edge of the screen.
        rule.onNodeWithTag(SettingsPhotosToggleTag).performClick()
        rule.onNodeWithTag(SettingsPhotosToggleTag).assertIsOff()
        assert(!app.container.chartPreferences.photosInChart.value) {
            "the setting did not reach the preference the charts read"
        }

        // And the chart is still a chart with it off — the discs simply carry initials instead.
        rule.onNodeWithTag(NavTreeTag).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(FamilyChartTag).fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag(FamilyChartTag).assertIsDisplayed()

        app.container.chartPreferences.setPhotosInChart(true)
    }

    /** The setting outlives the screen it is set on, which is the whole point of a setting. */
    @Test
    fun theChoiceIsRemembered() {
        app.container.chartPreferences.setPhotosInChart(false)
        seed()

        rule.onNodeWithTag(NavSettingsTag).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(SettingsPhotosToggleTag).fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag(SettingsPhotosToggleTag).assertIsOff()

        app.container.chartPreferences.setPhotosInChart(true)
    }
}

/**
 * The crop screen, wired to the arithmetic behind it.
 *
 * [com.vibethroughcode.ftree.ui.person.CircleCropTest] proves the sums; this proves the screen asks
 * for the square it is showing, which is the join the reader actually depends on.
 */
@RunWith(AndroidJUnit4::class)
class PhotoCropDialogTest {

    @get:Rule
    val rule = createComposeRule()

    @Test
    fun framingNothingStillReturnsTheMiddleOfThePicture() {
        val bitmap = Bitmap.createBitmap(400, 200, Bitmap.Config.ARGB_8888)
        var result: SquareCrop? = null

        rule.setContent {
            FTreeTheme {
                PhotoCropDialog(
                    request = CropRequest.Ready(bitmap),
                    onCancel = {},
                    onConfirm = { result = it },
                )
            }
        }

        rule.onNodeWithTag(PhotoCropConfirmTag).performClick()
        rule.waitForIdle()

        assertNotNull("no crop came back from the screen", result)
        // The short side fills the circle, so the square is the picture's height, centred.
        assertEquals(200, result!!.size)
        assertEquals(100, result!!.x)
        assertEquals(0, result!!.y)
    }

    @Test
    fun anUnreadableImageOffersAWayOutRatherThanAnEmptyScreen() {
        var cancelled = false
        rule.setContent {
            FTreeTheme {
                PhotoCropDialog(
                    request = CropRequest.Unreadable,
                    onCancel = { cancelled = true },
                    onConfirm = {},
                )
            }
        }

        rule.onAllNodesWithText("Cancel").onFirst().performClick()
        rule.waitForIdle()

        assert(cancelled) { "the reader was left on a dead screen" }
    }
}
