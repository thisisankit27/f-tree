package com.vibethroughcode.ftree.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.MainActivity
import com.vibethroughcode.ftree.data.RelativeKind
import com.vibethroughcode.ftree.ui.person.EditNameFieldTag
import com.vibethroughcode.ftree.ui.person.EditSaveTag
import com.vibethroughcode.ftree.ui.person.DeleteCompletelyTag
import com.vibethroughcode.ftree.ui.person.DeleteKeepAsUnknownTag
import com.vibethroughcode.ftree.ui.person.PersonDeleteTag
import com.vibethroughcode.ftree.ui.person.PersonEditTag
import com.vibethroughcode.ftree.ui.tree.TreePeopleButtonTag
import com.vibethroughcode.ftree.ui.person.addSectionTag
import com.vibethroughcode.ftree.ui.relative.AddRelativeNameTag
import com.vibethroughcode.ftree.ui.relative.AddRelativeSaveTag
import com.vibethroughcode.ftree.ui.relative.AddRelativeUnknownTag
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Building a family out from one person — the flow the whole app is organised around.
 */
@RunWith(AndroidJUnit4::class)
class RelationshipFlowTest {

    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    @Before
    fun emptyTheTree() {
        val app = InstrumentationRegistry.getInstrumentation()
            .targetContext.applicationContext as FTreeApplication
        app.container.database.clearAllTables()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText("Build your family tree").fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithText("Add your first person").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(EditNameFieldTag).performTextInput("Ankit")
        rule.onNodeWithTag(EditSaveTag).performScrollTo().performClick()
        rule.waitForIdle()
    }

    /** Adds a named relative of [kind] to whoever's page is open. */
    private fun addRelative(kind: RelativeKind, name: String) {
        rule.onNodeWithTag(addSectionTag(kind), useUnmergedTree = true)
            .performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(AddRelativeNameTag).performTextInput(name)
        rule.onNodeWithTag(AddRelativeSaveTag).performScrollTo().performClick()
        rule.waitForIdle()
    }

    @Test
    fun parentsSpousesAndChildrenAllAttachToTheOpenPerson() {
        addRelative(RelativeKind.PARENT, "Raj Kumar")
        addRelative(RelativeKind.SPOUSE, "Priya")
        addRelative(RelativeKind.CHILD, "Aarav")

        rule.onNodeWithText("Raj Kumar").assertIsDisplayed()
        rule.onNodeWithText("Priya").assertIsDisplayed()
        rule.onNodeWithText("Aarav").assertIsDisplayed()
    }

    @Test
    fun aRelativeIsLabelledByTheRoleTheyPlay() {
        rule.onNodeWithTag(addSectionTag(RelativeKind.PARENT), useUnmergedTree = true)
            .performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(AddRelativeNameTag).performTextInput("Raj Kumar")
        rule.onNodeWithText("Male").performClick()
        rule.onNodeWithTag(AddRelativeSaveTag).performScrollTo().performClick()
        rule.waitForIdle()

        // The graph stores one PARENT edge; the reader sees "Father".
        rule.onNodeWithText("Father").assertIsDisplayed()
    }

    @Test
    fun aRelativeWhoseNameIsUnknownIsStillARealPerson() {
        rule.onNodeWithTag(addSectionTag(RelativeKind.PARENT), useUnmergedTree = true)
            .performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(AddRelativeUnknownTag).performScrollTo().performClick()
        rule.waitForIdle()

        rule.onNodeWithText("Unknown").assertIsDisplayed()
    }

    @Test
    fun anUnknownRelativeCanBeNamedLaterWithoutLosingTheConnection() {
        rule.onNodeWithTag(addSectionTag(RelativeKind.PARENT), useUnmergedTree = true)
            .performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(AddRelativeUnknownTag).performScrollTo().performClick()
        rule.waitForIdle()

        // Open the placeholder and give them a name.
        rule.onNodeWithText("Unknown").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(PersonEditTag).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(EditNameFieldTag).performTextInput("Raj Kumar")
        rule.onNodeWithTag(EditSaveTag).performScrollTo().performClick()
        rule.waitForIdle()

        // Back on Ankit, the same relationship now names them.
        rule.onNodeWithContentDescription("Back").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Raj Kumar").assertIsDisplayed()
    }

    @Test
    fun siblingsAreDerivedFromTheParentsTheyShare() {
        addRelative(RelativeKind.PARENT, "Raj Kumar")
        addRelative(RelativeKind.SIBLING, "Neha")

        rule.onNodeWithText("Neha").assertIsDisplayed()

        // Neha is attached to the same parent, which is what makes them siblings.
        rule.onNodeWithText("Neha").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Raj Kumar").assertIsDisplayed()
        rule.onNodeWithText("Ankit").assertIsDisplayed()
    }

    @Test
    fun navigatingBetweenRelativesWorksInBothDirections() {
        addRelative(RelativeKind.CHILD, "Aarav")

        rule.onNodeWithText("Aarav").performClick()
        rule.waitForIdle()
        // From the child's page, the anchor now appears as a parent.
        rule.onNodeWithText("Ankit").assertIsDisplayed()

        rule.onNodeWithText("Ankit").performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Aarav").assertIsDisplayed()
    }

    @Test
    fun aDescendantIsNotOfferedAsAPossibleParent() {
        addRelative(RelativeKind.CHILD, "Aarav")

        rule.onNodeWithTag(addSectionTag(RelativeKind.PARENT), useUnmergedTree = true)
            .performScrollTo().performClick()
        rule.waitForIdle()

        // Aarav could only ever be refused as a parent, so he is not offered at all.
        assertTrue(rule.onAllNodesWithText("Aarav").fetchSemanticsNodes().isEmpty())
    }

    @Test
    fun deletingSomeoneConnectedOffersToKeepTheirPlaceInTheFamily() {
        addRelative(RelativeKind.PARENT, "Raj Kumar")
        addRelative(RelativeKind.CHILD, "Aarav")

        rule.onNodeWithTag(PersonDeleteTag).performClick()
        rule.waitForIdle()

        // Ankit joins his father to his son, so removing him outright would break that link.
        rule.onNodeWithTag(DeleteKeepAsUnknownTag).performClick()
        rule.waitForIdle()

        // He is now an unknown person, but the family still joins up through him.
        rule.onNodeWithText("Unknown").assertIsDisplayed()
        rule.onNodeWithText("Raj Kumar").assertIsDisplayed()
        rule.onNodeWithText("Aarav").assertIsDisplayed()
    }

    @Test
    fun deletingCompletelyRemovesTheirConnectionsToo() {
        addRelative(RelativeKind.PARENT, "Raj Kumar")

        rule.onNodeWithTag(PersonDeleteTag).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(DeleteCompletelyTag).performClick()
        rule.waitForIdle()

        // Raj remains — only Ankit and the link between them are gone.
        rule.onNodeWithTag(TreePeopleButtonTag).performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Raj Kumar").assertIsDisplayed()
        assertTrue(rule.onAllNodesWithText("Ankit").fetchSemanticsNodes().isEmpty())
    }

    @Test
    fun anAlreadyRecordedRelationshipIsRefusedWithAReason() {
        addRelative(RelativeKind.PARENT, "Raj Kumar")

        // Try to add the same person as a parent a second time.
        rule.onNodeWithTag(addSectionTag(RelativeKind.PARENT), useUnmergedTree = true)
            .performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithText("Raj Kumar").performScrollTo().performClick()
        rule.waitForIdle()

        rule.onNodeWithText("That relationship is already recorded.").assertIsDisplayed()
    }
}
