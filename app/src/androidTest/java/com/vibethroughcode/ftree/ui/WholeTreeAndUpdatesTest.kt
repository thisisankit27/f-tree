package com.vibethroughcode.ftree.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertTextContains
import com.vibethroughcode.ftree.ui.people.PeopleCountTag
import com.vibethroughcode.ftree.ui.people.PeopleFilterEveryoneTag
import com.vibethroughcode.ftree.ui.people.PeopleFilterLivingTag
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.MainActivity
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.data.RelativeKind
import com.vibethroughcode.ftree.ui.settings.SettingsUpdatesToggleTag
import com.vibethroughcode.ftree.ui.tree.FamilyChartTag
import com.vibethroughcode.ftree.ui.tree.TreeModeFocusedTag
import com.vibethroughcode.ftree.ui.tree.TreeModeWholeTag
import com.vibethroughcode.ftree.ui.tree.WholeFamilyChartTag
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The two things added to the app that carry a promise: a chart that leaves nobody out, and an
 * updater that stays silent until it is asked for.
 */
@RunWith(AndroidJUnit4::class)
class WholeTreeAndUpdatesTest {

    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    private val app: FTreeApplication
        get() = InstrumentationRegistry.getInstrumentation()
            .targetContext.applicationContext as FTreeApplication

    @Before
    fun emptyTheTree() {
        app.container.updatePreferences.setEnabled(false)
        app.container.database.clearAllTables()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText("Build your family tree").fetchSemanticsNodes().isNotEmpty()
        }
    }

    /** A connected pair, plus somebody nobody has connected to anything. */
    private fun seedWithAStranger() {
        val repository = app.container.familyRepository
        runBlocking {
            val parent = Person(name = "Vinod Kumar", birthDate = "1962")
            val child = Person(name = "Ankit Kumar", birthDate = "1990")
            val stranger = Person(name = "Ishwar Dutt", birthDate = "1928")
            listOf(parent, child, stranger).forEach { repository.addPerson(it) }
            repository.addRelative(child.id, parent.id, RelativeKind.PARENT)
        }
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(FamilyChartTag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun theWholeChartShowsSomebodyTheFocusedChartCannot() {
        seedWithAStranger()

        // The focused chart is drawn around one person, so a person with no relationship to
        // anybody has no place on it at all. That is the gap the other view exists to close.
        rule.onNodeWithTag(FamilyChartTag).assertIsDisplayed()

        rule.onNodeWithTag(TreeModeWholeTag).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(WholeFamilyChartTag).fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag(WholeFamilyChartTag).assertIsDisplayed()

        // The summary is the plainest statement of it, and it is ordinary text rather than canvas.
        rule.onNodeWithText("3 people", substring = true).assertIsDisplayed()
        rule.onNodeWithText("with no relatives recorded", substring = true).assertIsDisplayed()
    }

    @Test
    fun theChartModeSurvivesGoingAwayAndComingBack() {
        seedWithAStranger()
        rule.onNodeWithTag(TreeModeWholeTag).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(WholeFamilyChartTag).fetchSemanticsNodes().isNotEmpty()
        }

        rule.onNodeWithTag(NavPeopleTag).performClick()
        rule.onNodeWithText("Family").assertIsDisplayed()
        rule.onNodeWithTag(NavTreeTag).performClick()

        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(WholeFamilyChartTag).fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag(WholeFamilyChartTag).assertIsDisplayed()
    }

    @Test
    fun switchingBackToTheFocusedChartWorks() {
        seedWithAStranger()
        rule.onNodeWithTag(TreeModeWholeTag).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(WholeFamilyChartTag).fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag(TreeModeFocusedTag).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(FamilyChartTag).fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag(FamilyChartTag).assertIsDisplayed()
    }

    /**
     * The app declares INTERNET solely for the updater. If this ever starts failing, the app has
     * begun reaching the network on a default nobody chose, and the promise on the settings screen
     * has quietly stopped being true.
     */
    @Test
    fun updateCheckingIsOffUntilItIsSwitchedOn() {
        assertFalse(
            "updates must be off on a fresh install",
            app.container.updatePreferences.enabled.value,
        )

        rule.onNodeWithTag(NavSettingsTag).performClick()
        rule.onNodeWithText("Check for updates").assertIsDisplayed()
        rule.onNodeWithTag(SettingsUpdatesToggleTag).assertIsOff()

        // With it off there is nothing to check with, so no button offers to.
        rule.onAllNodesWithText("Check now").fetchSemanticsNodes().let {
            assert(it.isEmpty()) { "a check button was offered while updates were switched off" }
        }
    }

    @Test
    fun transferMovedToSettingsAndIsReachableThere() {
        rule.onNodeWithTag(NavSettingsTag).performClick()
        rule.onNodeWithText("Export your tree").assertIsDisplayed()
        rule.onNodeWithText("Import a tree").assertIsDisplayed()
    }

    /**
     * "Who is still with us" is a question people ask of a family record, and the answer is a
     * shorter list rather than a reordering of the same one.
     */
    @Test
    fun thePeopleListCanBeNarrowedToTheLiving() {
        val repository = app.container.familyRepository
        runBlocking {
            repository.addPerson(Person(name = "Shyam Lal", birthDate = "1905", deathDate = "1978"))
            repository.addPerson(Person(name = "Vinod Kumar", birthDate = "1962"))
            repository.addPerson(Person(name = "Ankit Kumar", birthDate = "1990"))
        }
        rule.onNodeWithTag(NavPeopleTag).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText("Shyam Lal").fetchSemanticsNodes().isNotEmpty()
        }

        rule.onNodeWithTag(PeopleFilterLivingTag).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText("Shyam Lal").fetchSemanticsNodes().isEmpty()
        }
        rule.onNodeWithText("Vinod Kumar").assertIsDisplayed()
        rule.onNodeWithText("Ankit Kumar").assertIsDisplayed()

        // And it says how many that leaves, against the whole tree.
        rule.onNodeWithTag(PeopleCountTag).assertTextContains("2 living, of 3 people in your tree")

        rule.onNodeWithTag(PeopleFilterEveryoneTag).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText("Shyam Lal").fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag(PeopleCountTag).assertTextContains("3 people in your tree")
    }

    /** A death date alone is enough; the flag is not the only way a record says somebody died. */
    @Test
    fun aDeathDateAloneIsEnoughToBeFilteredOut() {
        runBlocking {
            app.container.familyRepository.addPerson(
                Person(name = "Hari Lal", birthDate = "1902", deathDate = "1970", deceased = false)
            )
            app.container.familyRepository.addPerson(Person(name = "Neha Kumar", birthDate = "1993"))
        }
        rule.onNodeWithTag(NavPeopleTag).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText("Hari Lal").fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag(PeopleFilterLivingTag).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText("Hari Lal").fetchSemanticsNodes().isEmpty()
        }
        rule.onNodeWithText("Neha Kumar").assertIsDisplayed()
    }
}
