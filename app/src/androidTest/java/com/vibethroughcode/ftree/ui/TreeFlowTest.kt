package com.vibethroughcode.ftree.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.MainActivity
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.data.RelativeKind
import com.vibethroughcode.ftree.ui.person.EditNameFieldTag
import com.vibethroughcode.ftree.ui.person.EditSaveTag
import com.vibethroughcode.ftree.ui.tree.FamilyChartTag
import com.vibethroughcode.ftree.ui.NavPeopleTag
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** The chart: what it shows, and how the rest of the family stays reachable from it. */
@RunWith(AndroidJUnit4::class)
class TreeFlowTest {

    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    private val app: FTreeApplication
        get() = InstrumentationRegistry.getInstrumentation()
            .targetContext.applicationContext as FTreeApplication

    @Before
    fun emptyTheTree() {
        app.container.database.clearAllTables()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText("Build your family tree").fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun seedFamily() {
        val repository = app.container.familyRepository
        runBlocking {
            val me = Person(name = "Ankit Kumar", birthDate = "1990")
            val father = Person(name = "Vinod Kumar", birthDate = "1962")
            val child = Person(name = "Aarav Kumar", birthDate = "2020")
            listOf(me, father, child).forEach { repository.addPerson(it) }
            repository.addRelative(me.id, father.id, RelativeKind.PARENT)
            repository.addRelative(me.id, child.id, RelativeKind.CHILD)
        }
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(FamilyChartTag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun anEmptyTreeShowsTheInvitationRatherThanABlankChart() {
        rule.onNodeWithText("Build your family tree").assertIsDisplayed()
    }

    @Test
    fun theChartAppearsOnceSomebodyIsInTheTree() {
        seedFamily()
        rule.onNodeWithTag(FamilyChartTag).assertIsDisplayed()
    }

    @Test
    fun tappingSomebodyOnTheChartOpensTheirActions() {
        // One person only: the chart fits, so it is centred and the single node sits under the
        // middle of the canvas, which makes the tap deterministic.
        rule.onNodeWithText("Add your first person").performClick()
        rule.waitForIdle()
        rule.onNodeWithTag(EditNameFieldTag).performTextInput("Ankit Kumar")
        rule.onNodeWithTag(EditSaveTag).performScrollTo().performClick()
        rule.waitForIdle()
        rule.onNodeWithContentDescription("Back").performClick()
        rule.waitForIdle()

        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(FamilyChartTag).fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag(FamilyChartTag).performTouchInput { click(center) }
        rule.waitForIdle()

        // "Centre the tree here" is deliberately absent: they are already the focus, so it would
        // be an action that does nothing.
        rule.onNodeWithText("Open Ankit Kumar").assertIsDisplayed()
        assertTrue(
            rule.onAllNodesWithText("Centre the tree here").fetchSemanticsNodes().isEmpty()
        )
    }

    @Test
    fun thePeopleListIsReachableFromTheChart() {
        seedFamily()

        rule.onNodeWithTag(NavPeopleTag).performClick()
        rule.waitForIdle()

        rule.onNodeWithText("Vinod Kumar").assertIsDisplayed()
        rule.onNodeWithText("Aarav Kumar").assertIsDisplayed()
    }

    @Test
    fun theChartDescribesItselfForAScreenReader() {
        seedFamily()

        // Canvas text is invisible to accessibility services, so the chart carries a description
        // and points at the list, which is the readable route to the same information.
        rule.onNodeWithTag(FamilyChartTag).assertIsDisplayed()
        rule.onAllNodesWithText("Family tree").fetchSemanticsNodes().isNotEmpty()
    }
}
