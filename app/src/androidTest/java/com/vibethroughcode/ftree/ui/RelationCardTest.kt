package com.vibethroughcode.ftree.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.Density
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vibethroughcode.ftree.data.Gender
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.graph.Relation
import com.vibethroughcode.ftree.graph.RelationStep
import com.vibethroughcode.ftree.graph.StepKind
import com.vibethroughcode.ftree.ui.relation.CARD_DENSITY
import com.vibethroughcode.ftree.ui.relation.CARD_HEIGHT
import com.vibethroughcode.ftree.ui.relation.CARD_WIDTH
import com.vibethroughcode.ftree.ui.relation.ChainLink
import com.vibethroughcode.ftree.ui.relation.RelationCard
import com.vibethroughcode.ftree.ui.relation.RelationPicture
import com.vibethroughcode.ftree.ui.relation.RelationUiState
import com.vibethroughcode.ftree.ui.relation.ShareCardPreviewTag
import com.vibethroughcode.ftree.ui.relation.ShareCardSendTag
import com.vibethroughcode.ftree.ui.relation.ShareRelationDialog
import com.vibethroughcode.ftree.ui.theme.FTreeTheme
import java.io.File
import java.io.FileOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The picture that gets sent, measured rather than looked at.
 *
 * The card is a fixed 360 by 450 and the sentence above the people is not, so the only question
 * that matters here is whether what is drawn stays inside its own frame. "Nearly overflowing" and
 * "overflowing" look identical in a screenshot, so every claim below is a comparison of bounds.
 */
@RunWith(AndroidJUnit4::class)
class RelationCardTest {

    @get:Rule
    val rule = createComposeRule()

    private val footer = "ftree.vibethroughcode.com"

    private fun chain(vararg names: String): RelationUiState {
        val people = names.map { Person(name = it, gender = Gender.MALE) }
        return RelationUiState(
            loading = false,
            from = people.first(),
            to = people.last(),
            chain = people.drop(1).map { ChainLink(it, StepKind.PARENT) },
        )
    }

    private fun found(state: RelationUiState) = Relation.Found(
        chain = state.chain.map { RelationStep(it.person.id, it.kind) },
        term = null,
        sharedAncestorId = null,
    )

    /** Composes the card at the size it is exported at, and keeps the image for a human to see. */
    private fun show(state: RelationUiState, name: String) {
        rule.setContent {
            FTreeTheme(darkTheme = true) {
                CompositionLocalProvider(LocalDensity provides Density(CARD_DENSITY, 1f)) {
                    Box(Modifier.requiredSize(CARD_WIDTH, CARD_HEIGHT).testTag("card")) {
                        RelationCard(state = state, relation = found(state))
                    }
                }
            }
        }
        val image = rule.onNodeWithTag("card").captureToImage().asAndroidBitmap()
        val directory = InstrumentationRegistry.getInstrumentation()
            .targetContext.getExternalFilesDir(null)!!
        FileOutputStream(File(directory, "$name.png")).use {
            image.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    /** Nobody drawn on the card may run into the rule above the footer. */
    private fun assertFitsAboveTheFooter(last: String) {
        val bottom = rule.onNodeWithText(last).getUnclippedBoundsInRoot().bottom
        val footerTop = rule.onNodeWithText(footer).getUnclippedBoundsInRoot().top
        assertTrue("$last ends at $bottom, past the footer at $footerTop", bottom <= footerTop)
    }

    @Test
    fun fourPeopleFitWithoutBeingSquashedIntoTheFooter() {
        val state = chain("Ankit Srivastava", "Pragya Srivastava", "Kinshuk Srivastava", "Akshit Srivastava")
        show(state, "card-four")

        // All four, because four is what there was room for — the count is what the card avoids
        // when it can, not something it reaches for.
        rule.onNodeWithText("Ankit Srivastava").assertIsDisplayed()
        rule.onNodeWithText("Pragya Srivastava").assertIsDisplayed()
        rule.onNodeWithText("Kinshuk Srivastava").assertIsDisplayed()
        rule.onNodeWithText("Akshit Srivastava").assertIsDisplayed()
        assertFitsAboveTheFooter("Akshit Srivastava")
    }

    @Test
    fun twoPeopleSitTogetherRatherThanDriftingApart() {
        val state = chain("Ankit Srivastava", "Sarika Srivastava")
        show(state, "card-two")

        rule.onNodeWithText("Sarika Srivastava").assertIsDisplayed()
        assertFitsAboveTheFooter("Sarika Srivastava")
    }

    /**
     * The case that was wrong: a Hindi term with its English gloss runs to four lines, and the
     * fourth person was left overlapping the footer.
     */
    @Test
    fun fourPeopleStillFitUnderALongSentence() {
        val state = chain(
            "Akshit Kumar Srivastava", "Pragya Kumari Srivastava",
            "Kinshuk Kumar Srivastava", "Sarika Kumari Srivastava",
        )
        show(state, "card-four-long")

        rule.onNodeWithText("Akshit Kumar Srivastava").assertIsDisplayed()
        rule.onNodeWithText("Sarika Kumari Srivastava").assertIsDisplayed()
        assertFitsAboveTheFooter("Sarika Kumari Srivastava")
    }

    /**
     * The preview has to sit inside the screen it is shown on.
     *
     * The card has a size of its own and the phone does not, so the preview scales it — and the
     * only thing that can go wrong is the scaled drawing being centred on a size it is not, which
     * puts it half off the top-left corner. What is asserted is the frame, not the appearance.
     */
    @Test
    fun theSheetShowsTheWholeCardInsideTheScreen() {
        val state = chain("Ankit Srivastava", "Pragya Srivastava", "Kinshuk Srivastava", "Akshit Srivastava")
        rule.setContent {
            FTreeTheme(darkTheme = true) {
                ShareRelationDialog(
                    state = state,
                    relation = found(state),
                    onDismiss = {},
                    onSend = {},
                )
            }
        }

        /*
         * Compared in pixels, deliberately. The card carries a density of its own — that is what
         * fixes the export at 1080 by 1350 — so its bounds in dp are in different units from the
         * sheet's around it, and comparing those two numbers proves nothing.
         */
        val sheet = rule.onNode(isDialog()).fetchSemanticsNode()
        val preview = rule.onNodeWithTag(ShareCardPreviewTag).fetchSemanticsNode()
        val left = preview.positionInRoot.x
        val top = preview.positionInRoot.y
        val frame = "preview ${preview.size} at ($left, $top) in a sheet of ${sheet.size}"
        assertTrue("$frame starts off the left", left >= 0f)
        assertTrue("$frame starts off the top", top >= 0f)
        assertTrue("$frame runs past the right", left + preview.size.width <= sheet.size.width)
        assertTrue("$frame runs past the bottom", top + preview.size.height <= sheet.size.height)
        // And centred across the sheet, rather than merely inside it.
        val slack = sheet.size.width - preview.size.width
        assertTrue("$frame is not centred", kotlin.math.abs(left - slack / 2f) <= 1f)

        val image = rule.onNode(isDialog()).captureToImage().asAndroidBitmap()
        val directory = InstrumentationRegistry.getInstrumentation()
            .targetContext.getExternalFilesDir(null)!!
        FileOutputStream(File(directory, "sheet.png")).use {
            image.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    /**
     * What Send hands over is the picture at its own size, not the preview at the screen's.
     *
     * The preview is scaled to whatever room the phone has, so this is the assertion that keeps
     * the file the same on every device: a big screen shows a bigger card and sends the same one.
     */
    @Test
    fun theSentPictureIsTheSameSizeWhateverTheScreen() {
        val state = chain("Ankit Srivastava", "Pragya Srivastava", "Kinshuk Srivastava", "Akshit Srivastava")
        var sent: RelationPicture? = null
        rule.setContent {
            FTreeTheme(darkTheme = true) {
                ShareRelationDialog(
                    state = state,
                    relation = found(state),
                    onDismiss = {},
                    onSend = { sent = it },
                )
            }
        }

        rule.onNodeWithTag(ShareCardSendTag).performClick()
        rule.waitUntil(5_000) { sent != null }

        val picture = sent!!
        assertEquals(1080, picture.image.width)
        assertEquals(1350, picture.image.height)
        // The caption travels with it, which is the whole reason this is a picture and not a file.
        assertTrue("caption was ${picture.caption}", picture.caption.contains(footer))

        val directory = InstrumentationRegistry.getInstrumentation()
            .targetContext.getExternalFilesDir(null)!!
        FileOutputStream(File(directory, "sent.png")).use {
            picture.image.asAndroidBitmap()
                .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test
    fun aLongLineIsCountedRatherThanCut() {
        val state = chain(
            "Ankit Srivastava", "Pragya Srivastava", "Kinshuk Srivastava", "Akshit Srivastava",
            "Meena Srivastava", "Vinod Srivastava", "Sunita Srivastava", "Aarav Srivastava",
        )
        show(state, "card-eight")

        // Both ends, because they are the two people the question was about.
        rule.onNodeWithText("Ankit Srivastava").assertIsDisplayed()
        rule.onNodeWithText("Aarav Srivastava").assertIsDisplayed()
        // And the middle counted rather than silently dropped.
        rule.onNodeWithText("more", substring = true).assertIsDisplayed()
        assertFitsAboveTheFooter("Aarav Srivastava")
    }
}
