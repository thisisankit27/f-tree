package com.vibethroughcode.ftree.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.MainActivity
import com.vibethroughcode.ftree.ui.people.PeopleAddFabTag
import com.vibethroughcode.ftree.ui.people.PeopleSearchFieldTag
import com.vibethroughcode.ftree.ui.person.DeleteCompletelyTag
import com.vibethroughcode.ftree.ui.person.EditBornFieldTag
import com.vibethroughcode.ftree.ui.person.EditNameFieldTag
import com.vibethroughcode.ftree.ui.person.EditSaveTag
import com.vibethroughcode.ftree.ui.person.PersonDeleteTag
import com.vibethroughcode.ftree.ui.person.PersonMenuTag
import com.vibethroughcode.ftree.ui.person.PersonEditTag
import com.vibethroughcode.ftree.ui.NavPeopleTag
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** The person-management flows, driven through the real activity and the real database. */
@RunWith(AndroidJUnit4::class)
class PersonFlowTest {

    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    @Before
    fun emptyTheTree() {
        val app = InstrumentationRegistry.getInstrumentation()
            .targetContext.applicationContext as FTreeApplication
        app.container.database.clearAllTables()
        // The list is driven by a live query, so wait for the empty state rather than assuming
        // the UI has caught up with the wipe.
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText("Build your family tree").fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun fillAndSave(name: String? = null, born: String? = null) {
        if (name != null) rule.onNodeWithTag(EditNameFieldTag).performTextInput(name)
        if (born != null) rule.onNodeWithTag(EditBornFieldTag).performTextInput(born)
        rule.onNodeWithTag(EditSaveTag).performScrollTo().performClick()
        rule.waitForIdle()
    }

    private fun addFirstPerson(name: String? = null, born: String? = null) {
        rule.onNodeWithText("Add your first person").performClick()
        rule.waitForIdle()
        fillAndSave(name, born)
    }

    private fun goBack() {
        rule.onNodeWithContentDescription("Back").performClick()
        rule.waitForIdle()
    }

    /** Home is the chart; the list of everyone is one tap away from it. */
    private fun openPeopleList() {
        rule.onNodeWithTag(NavPeopleTag).performClick()
        rule.waitForIdle()
    }

    @Test
    fun anEmptyTreeInvitesTheFirstPerson() {
        rule.onNodeWithText("Build your family tree").assertIsDisplayed()
        rule.onNodeWithText("Add your first person").assertIsDisplayed()
    }

    @Test
    fun addingAPersonOpensTheirPage() {
        addFirstPerson("Ankit Kumar", "1990-05-01")

        rule.onNodeWithText("Ankit Kumar").assertIsDisplayed()
        rule.onNodeWithText("36 years old").assertIsDisplayed()
    }

    @Test
    fun aPersonWithNothingRecordedIsStillValid() {
        addFirstPerson()

        rule.onNodeWithText("Unknown").assertIsDisplayed()
        rule.onNodeWithText("No dates recorded").assertIsDisplayed()
    }

    @Test
    fun anUnknownPersonCanBeGivenANameLater() {
        addFirstPerson()

        rule.onNodeWithTag(PersonEditTag).performClick()
        rule.waitForIdle()
        fillAndSave(name = "Raj Kumar")

        rule.onNodeWithText("Raj Kumar").assertIsDisplayed()
    }

    @Test
    fun aMalformedDateBlocksSaving() {
        rule.onNodeWithText("Add your first person").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(EditBornFieldTag).performTextInput("not a date")
        rule.waitForIdle()

        rule.onNodeWithText("Use a year like 1938, or 1938-04-17").assertIsDisplayed()
        rule.onNodeWithTag(EditSaveTag).performScrollTo().assertIsNotEnabled()
    }

    @Test
    fun aYearAloneIsAValidBirthDate() {
        addFirstPerson("Grandfather", "1938")

        rule.onNodeWithText("Born 1938").assertIsDisplayed()
    }

    @Test
    fun editingAPersonLeavesUntouchedFieldsAlone() {
        addFirstPerson("Ankit", "1990")

        rule.onNodeWithTag(PersonEditTag).performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(EditNameFieldTag).performTextClearance()
        rule.onNodeWithTag(EditNameFieldTag).performTextInput("Ankit Kumar")
        rule.onNodeWithTag(EditSaveTag).performScrollTo().performClick()
        rule.waitForIdle()

        rule.onNodeWithText("Ankit Kumar").assertIsDisplayed()
        rule.onNodeWithText("Born 1990").assertIsDisplayed()
    }

    @Test
    fun peopleAreListedAndSearchable() {
        addFirstPerson("Ankit Kumar")
        goBack()
        openPeopleList()

        rule.onNodeWithTag(PeopleAddFabTag).performClick()
        rule.waitForIdle()
        fillAndSave("Priya Sharma")
        goBack()

        rule.onNodeWithText("Ankit Kumar").assertIsDisplayed()
        rule.onNodeWithText("Priya Sharma").assertIsDisplayed()

        rule.onNodeWithContentDescription("Search").performClick()
        rule.onNodeWithTag(PeopleSearchFieldTag).performTextInput("Priya")
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText("Ankit Kumar").fetchSemanticsNodes().isEmpty()
        }
        rule.onNodeWithText("Priya Sharma").assertIsDisplayed()
    }

    @Test
    fun deletingSomeoneWithNoConnectionsOffersOnlyRemoval() {
        addFirstPerson("Ankit Kumar")

        rule.onNodeWithTag(PersonMenuTag).performClick()
        rule.onNodeWithTag(PersonDeleteTag).performClick()
        rule.waitForIdle()

        // Nobody is connected, so "keep as unknown" would be a choice about nothing.
        assertTrue(
            rule.onAllNodesWithTag(com.vibethroughcode.ftree.ui.person.DeleteKeepAsUnknownTag)
                .fetchSemanticsNodes().isEmpty()
        )

        rule.onNodeWithTag(DeleteCompletelyTag).performClick()

        // Waiting for the empty state itself, not for idleness: the delete pops a screen, and the
        // chart only calls itself empty once both the focused and the whole-tree view models have
        // reported the tree gone. Idle can arrive a frame before the second of them does.
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText("Build your family tree").fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithText("Build your family tree").assertIsDisplayed()
    }

    @Test
    fun dataSurvivesTheScreenBeingRecreated() {
        addFirstPerson("Ankit Kumar", "1990")
        goBack()
        openPeopleList()

        rule.activity.runOnUiThread { rule.activity.recreate() }
        rule.waitForIdle()

        // The list is asserted rather than the chart because chart text is painted onto a canvas
        // and carries no semantics of its own. The navigation state survives recreation, so the
        // list is still the screen in front of us.
        rule.onNodeWithText("Ankit Kumar").assertIsDisplayed()
    }
}
