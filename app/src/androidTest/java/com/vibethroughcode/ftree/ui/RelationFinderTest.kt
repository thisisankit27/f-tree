package com.vibethroughcode.ftree.ui

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.MainActivity
import com.vibethroughcode.ftree.data.Gender
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.data.RelativeKind
import com.vibethroughcode.ftree.ui.relation.RelationAnswerTag
import com.vibethroughcode.ftree.ui.relation.RelationPickListTag
import com.vibethroughcode.ftree.ui.relation.RelationPickSearchTag
import com.vibethroughcode.ftree.ui.relation.RelationShowOnChartTag
import com.vibethroughcode.ftree.ui.relation.RelationSlotFromTag
import com.vibethroughcode.ftree.ui.relation.RelationSlotToTag
import com.vibethroughcode.ftree.ui.relation.RelationSwapTag
import com.vibethroughcode.ftree.ui.tree.FamilyChartTag
import com.vibethroughcode.ftree.ui.tree.TreeClearTraceTag
import com.vibethroughcode.ftree.ui.tree.TreeRelateTag
import com.vibethroughcode.ftree.ui.tree.WholeFamilyChartTag
import kotlinx.coroutines.runBlocking
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Asking how two people are related, from the chart through to the answer and back onto the chart.
 *
 * The words themselves are settled on the JVM in `KinshipTest`; what is worth an emulator is that
 * the two people can actually be picked, that the answer names the pair the right way round, and
 * that "show me" lands on a chart with the line on it.
 */
@RunWith(AndroidJUnit4::class)
class RelationFinderTest {

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

    /** Three generations down one line, and an aunt off to the side. */
    private fun seedFourPeople() {
        val repository = app.container.familyRepository
        runBlocking {
            // Recorded gender is what narrows "aunt or uncle" to "aunt", so it is part of the
            // fixture rather than incidental to it.
            val grandad = Person(name = "Raj Kumar", gender = Gender.MALE, birthDate = "1938")
            val dad = Person(name = "Vinod Kumar", gender = Gender.MALE, birthDate = "1962")
            val aunt = Person(name = "Meena Devi", gender = Gender.FEMALE, birthDate = "1968")
            val me = Person(name = "Ankit Kumar", gender = Gender.MALE, birthDate = "1990")
            listOf(grandad, dad, aunt, me).forEach { repository.addPerson(it) }
            repository.addRelative(dad.id, grandad.id, RelativeKind.PARENT)
            repository.addRelative(aunt.id, grandad.id, RelativeKind.PARENT)
            repository.addRelative(me.id, dad.id, RelativeKind.PARENT)
        }
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(FamilyChartTag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun openFinder() {
        rule.onNodeWithTag(TreeRelateTag).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(RelationSlotFromTag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun pick(slotTag: String, name: String) {
        rule.onNodeWithTag(slotTag).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(RelationPickSearchTag).fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag(RelationPickSearchTag).performTextInput(name)
        // Scoped to the list: the search field now holds the same words, and a bare text match
        // would find it first.
        val row = hasText(name) and hasAnyAncestor(hasTestTag(RelationPickListTag))
        rule.waitUntil(5_000) { rule.onAllNodes(row).fetchSemanticsNodes().isNotEmpty() }
        rule.onNode(row).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(RelationSlotFromTag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    /**
     * Relating two people walks the whole graph off the main thread, so the answer lands a beat
     * after the pick. Waiting for the sentence is the honest way to say "eventually it reads this".
     */
    private fun awaitText(text: String) {
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithText(text).assertIsDisplayed()
    }

    @Test
    fun twoPeopleTwoGenerationsApartAreNamedAndTheirLineShown() {
        seedFourPeople()
        openFinder()

        pick(RelationSlotFromTag, "Ankit Kumar")
        pick(RelationSlotToTag, "Meena Devi")

        rule.onNodeWithTag(RelationAnswerTag).assertIsDisplayed()
        awaitText("Meena Devi is Ankit Kumar’s aunt.")
        rule.onNodeWithText("2 steps apart").assertIsDisplayed()

        // The working, not just the verdict: the father is the person the line runs through, and
        // saying so is what lets a reader check the answer against what they already know.
        rule.onNodeWithText("Father of Ankit Kumar").assertIsDisplayed()
        rule.onNodeWithText("Sister of Vinod Kumar").assertIsDisplayed()
    }

    @Test
    fun swappingTheTwoAsksTheOtherQuestionAndGetsTheOtherWord() {
        seedFourPeople()
        openFinder()

        pick(RelationSlotFromTag, "Ankit Kumar")
        pick(RelationSlotToTag, "Raj Kumar")
        awaitText("Raj Kumar is Ankit Kumar’s grandfather.")

        rule.onNodeWithTag(RelationSwapTag).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText("Ankit Kumar is Raj Kumar’s grandson.")
                .fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test
    fun peopleTheRecordDoesNotJoinAreSaidToBeUnjoined() {
        seedFourPeople()
        runBlocking {
            app.container.familyRepository.addPerson(Person(name = "Ishwar Dutt", birthDate = "1928"))
        }
        openFinder()

        pick(RelationSlotFromTag, "Ankit Kumar")
        pick(RelationSlotToTag, "Ishwar Dutt")

        rule.waitUntil(5_000) {
            rule.onAllNodesWithText("Nothing in the record joins", substring = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
        // Absence of a connection is not a claim that there is none, and the wording says so.
        rule.onNodeWithText("They may well be related", substring = true).assertIsDisplayed()
    }

    @Test
    fun showingTheLineOnTheChartSwitchesToTheChartThatCanHoldIt() {
        seedFourPeople()
        openFinder()

        pick(RelationSlotFromTag, "Ankit Kumar")
        pick(RelationSlotToTag, "Meena Devi")
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(RelationShowOnChartTag).fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag(RelationShowOnChartTag).performClick()

        // The focused chart draws one person's neighbourhood, so a line across the family only
        // means anything on the whole-tree one; asking to see it has to take you there.
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(WholeFamilyChartTag).fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithText("Tracing how two people connect").assertIsDisplayed()

        rule.onNodeWithTag(TreeClearTraceTag).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText("Tracing how two people connect").fetchSemanticsNodes().isEmpty()
        }
    }
}
