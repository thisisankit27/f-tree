package com.vibethroughcode.ftree.ui

import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
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
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
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
import com.vibethroughcode.ftree.ui.relation.RelationCloseTag
import com.vibethroughcode.ftree.ui.relation.RelationShareCardTag
import com.vibethroughcode.ftree.ui.relation.RelationSlotFromTag
import com.vibethroughcode.ftree.ui.relation.RelationSlotToTag
import com.vibethroughcode.ftree.ui.relation.RelationSwapTag
import com.vibethroughcode.ftree.ui.tree.FamilyChartTag
import com.vibethroughcode.ftree.ui.tree.TreeRelateTag
import com.vibethroughcode.ftree.ui.tree.WholeFamilyChartTag
import kotlinx.coroutines.runBlocking
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Asking how two people are related, on the chart that draws the answer.
 *
 * The words themselves are settled on the JVM in `KinshipTest`; what is worth an emulator is that
 * the two people can actually be picked, that the answer names the pair the right way round, and
 * that the sentence and the drawing of it are on screen *together* — there is no longer a second
 * place to go and look at the line, which is the whole point of the sheet.
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
     * Opens the sheet the rest of the way.
     *
     * The sentence and the way to send it stand above the fold; who exactly the line runs through
     * is underneath it, because that is what a reader consults rather than reads. Anything below
     * has to be dragged for, here as on the phone.
     */
    private fun openTheWorking() {
        // Dragged from the sentence rather than from the sheet as a whole: the sheet is taller
        // than the screen once it holds a chain, and a gesture aimed at the middle of it starts
        // somewhere the window does not reach.
        rule.onNodeWithTag(RelationAnswerTag).performTouchInput {
            swipeUp(startY = center.y, endY = center.y - 1_200f, durationMillis = 300)
        }
        rule.waitForIdle()
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
        openTheWorking()
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

        openTheWorking()
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

    /**
     * The answer and the picture of it are on screen at once.
     *
     * This is the fix for the thing that made the old flow unusable: seeing the line used to mean
     * leaving the sentence behind on a screen with no way back to it. Nothing is navigated here —
     * the same act that answers the question draws it.
     */
    @Test
    fun theLineIsDrawnWithoutLeavingTheAnswerBehind() {
        seedFourPeople()
        openFinder()

        pick(RelationSlotFromTag, "Ankit Kumar")
        pick(RelationSlotToTag, "Meena Devi")

        // The focused chart draws one person's neighbourhood, so a line across the family only
        // means anything on the whole-tree one: answering has to switch to the chart that holds it.
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(WholeFamilyChartTag).fetchSemanticsNodes().isNotEmpty()
        }
        // And the sentence is still there, on top of it.
        awaitText("Meena Devi is Ankit Kumar’s aunt.")
        // As is the way to send it — which used to exist only on the screen you had just left.
        rule.onNodeWithTag(RelationShareCardTag).assertIsDisplayed()
    }

    @Test
    fun closingTheQuestionPutsTheRestOfTheFamilyBack() {
        seedFourPeople()
        // Somebody with no part in the answer, who must not be on the chart while it is given.
        runBlocking {
            app.container.familyRepository.addPerson(
                Person(name = "Sunita Rao", gender = Gender.FEMALE, birthDate = "1995")
            )
        }
        openFinder()

        pick(RelationSlotFromTag, "Ankit Kumar")
        pick(RelationSlotToTag, "Meena Devi")

        /*
         * Four: Ankit, his father, his aunt, and the grandfather the two of them are siblings
         * through. He is on the chart without being in the sentence — the sibling step has no edge
         * of its own, so without him the answer would be two loose cards.
         *
         * Not Sunita. Fading her would still leave her on the page, and in a real tree that is a
         * hundred and forty faded cards over the answer.
         */
        awaitChartOf(4)

        rule.onNodeWithTag(RelationCloseTag).performClick()
        awaitChartOf(5)
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText("Meena Devi is Ankit Kumar’s aunt.").fetchSemanticsNodes().isEmpty()
        }
    }

    /**
     * Backing out of the question leaves the chart, not the screen.
     *
     * A sheet that the back gesture walked straight past would put the reader somewhere else
     * entirely, which is the failure the old flow had in the other direction.
     */
    @Test
    fun theBackGestureClosesTheQuestionRatherThanTheChart() {
        seedFourPeople()
        openFinder()
        pick(RelationSlotFromTag, "Ankit Kumar")

        rule.activity.runOnUiThread { rule.activity.onBackPressedDispatcher.onBackPressed() }

        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(RelationSlotFromTag).fetchSemanticsNodes().isEmpty()
        }
        rule.onNodeWithTag(FamilyChartTag).assertIsDisplayed()
    }

    /** Waits for the whole-tree canvas to say, in its own words, how many people it is drawing. */
    private fun awaitChartOf(people: Int) {
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(WholeFamilyChartTag).fetchSemanticsNodes().any { node ->
                node.config.getOrNull(SemanticsProperties.ContentDescription)
                    ?.any { it.contains("showing $people people") } == true
            }
        }
    }
}
