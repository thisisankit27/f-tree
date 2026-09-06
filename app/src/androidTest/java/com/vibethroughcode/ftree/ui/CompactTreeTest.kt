package com.vibethroughcode.ftree.ui

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.performScrollToIndex
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.MainActivity
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.data.RelativeKind
import com.vibethroughcode.ftree.ui.tree.CompactFamilyTag
import com.vibethroughcode.ftree.ui.tree.CompactFocusTag
import com.vibethroughcode.ftree.ui.tree.FamilyChartTag
import com.vibethroughcode.ftree.ui.tree.TreeModeCompactTag
import com.vibethroughcode.ftree.ui.tree.TreeModeFocusedTag
import com.vibethroughcode.ftree.ui.tree.TreeOpenPersonTag
import com.vibethroughcode.ftree.ui.tree.compactAddTag
import com.vibethroughcode.ftree.ui.tree.compactPersonTag
import kotlinx.coroutines.runBlocking
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The compact view: a family read rather than drawn.
 *
 * Everything here is asserted through ordinary text and content descriptions, which is the point of
 * the view — none of it could be written against the charts, because a canvas holds nothing for a
 * test or for a screen reader to find.
 */
@RunWith(AndroidJUnit4::class)
class CompactTreeTest {

    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    private val app: FTreeApplication
        get() = InstrumentationRegistry.getInstrumentation()
            .targetContext.applicationContext as FTreeApplication

    private lateinit var ankit: Person
    private lateinit var vinod: Person
    private lateinit var sunita: Person
    private lateinit var priya: Person
    private lateinit var aarav: Person

    @Before
    fun emptyTheTree() {
        app.container.database.clearAllTables()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText("Build your family tree").fetchSemanticsNodes().isNotEmpty()
        }
    }

    /** Three generations, with a marriage on each of the first two. */
    private fun seedFamily() {
        val repository = app.container.familyRepository
        ankit = Person(name = "Ankit Kumar", birthDate = "1990")
        vinod = Person(name = "Vinod Kumar", birthDate = "1962")
        sunita = Person(name = "Sunita Kumar", birthDate = "1965")
        priya = Person(name = "Priya Kumar", birthDate = "1992")
        aarav = Person(name = "Aarav Kumar", birthDate = "2020")
        runBlocking {
            listOf(ankit, vinod, sunita, priya, aarav).forEach { repository.addPerson(it) }
            repository.addRelative(ankit.id, vinod.id, RelativeKind.PARENT)
            repository.addRelative(ankit.id, sunita.id, RelativeKind.PARENT)
            repository.addRelative(vinod.id, sunita.id, RelativeKind.SPOUSE)
            repository.addRelative(ankit.id, priya.id, RelativeKind.SPOUSE)
            repository.addRelative(ankit.id, aarav.id, RelativeKind.CHILD)
        }
        rule.waitUntil(10_000) {
            rule.onAllNodesWithTag(FamilyChartTag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun openCompact() {
        rule.onNodeWithTag(TreeModeCompactTag).performClick()
        rule.waitUntil(10_000) {
            rule.onAllNodesWithTag(CompactFamilyTag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun isCentre(person: Person): Boolean = rule.onAllNodes(
        hasTestTag(CompactFocusTag) and hasContentDescription(person.name!!, substring = true)
    ).fetchSemanticsNodes().isNotEmpty()

    /**
     * Puts the tree on a known person, the way a reader would: find them in the people list and
     * ask to see them on the tree.
     *
     * The screen opens on whoever the record was already centred on — a property worth having, and
     * not one a test should depend on. Going through the people list also proves the thing this
     * feature turns on: one focus behind all three views, so where you are is where you stay.
     */
    private fun centreOn(person: Person) {
        rule.onNodeWithTag(NavPeopleTag).performClick()
        rule.waitUntil(10_000) {
            rule.onAllNodesWithText(person.name!!).fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithText(person.name!!).performClick()
        rule.waitUntil(10_000) {
            rule.onAllNodesWithContentDescription("Show on the tree").fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithContentDescription("Show on the tree").performClick()
        rule.waitUntil(10_000) {
            rule.onAllNodesWithTag(FamilyChartTag).fetchSemanticsNodes().isNotEmpty() ||
                rule.onAllNodesWithTag(CompactFamilyTag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun hasCard(person: Person): Boolean =
        rule.onAllNodesWithTag(compactPersonTag(person.id)).fetchSemanticsNodes().isNotEmpty()

    /**
     * Waits for somebody's card to arrive.
     *
     * The chart appears as soon as the first person is written, which can be several relationships
     * before the family is whole.
     */
    private fun waitForCard(person: Person) {
        rule.waitUntil(10_000) { hasCard(person) }
    }

    /** Waits for the view to finish re-centring itself on somebody after a tap. */
    private fun waitForCentre(person: Person) {
        rule.waitUntil(10_000) { isCentre(person) }
    }

    @Test
    fun theTreeStillOpensOnTheChartAroundOnePerson() {
        seedFamily()

        // Three views now, and the one the screen opens on is unchanged: the family around you.
        rule.onNodeWithTag(FamilyChartTag).assertIsDisplayed()
    }

    @Test
    fun aFamilyIsLaidOutInGenerationsThatCanActuallyBeRead() {
        seedFamily()
        centreOn(ankit)
        openCompact()
        waitForCentre(ankit)
        waitForCard(vinod)

        rule.onNodeWithTag(CompactFocusTag).assertTextContains("Ankit Kumar", substring = true)

        // The headings, and the people under them, are text — not pixels on a canvas.
        rule.onNodeWithText("PARENTS").assertIsDisplayed()
        rule.onNodeWithTag(compactPersonTag(vinod.id)).assertIsDisplayed()
        rule.onNodeWithTag(compactPersonTag(sunita.id)).assertIsDisplayed()

        // A generation below the fold is a scroll away rather than a pinch away, and is not built
        // at all until it is reached — which is what keeps the view cheap on a large family.
        rule.onNodeWithTag(CompactFamilyTag).performScrollToIndex(2)
        rule.onNodeWithText("CHILDREN").assertIsDisplayed()
        waitForCard(aarav)
    }

    @Test
    fun everyPersonIsAnnouncedAsOneThingRatherThanThreeFragments() {
        seedFamily()
        centreOn(ankit)
        openCompact()
        waitForCentre(ankit)
        waitForCard(vinod)

        // A screen reader gets "Vinod Kumar, 1962" in one stop, not an avatar, then a name, then
        // a year. This is the assertion the charts cannot make at all.
        rule.onNodeWithContentDescription("Vinod Kumar, 1962").assertIsDisplayed()
    }

    @Test
    fun whoeverTheCentreMarriedIsShownWithThemRatherThanBesideThem() {
        seedFamily()
        centreOn(ankit)
        openCompact()
        waitForCentre(ankit)
        waitForCard(priya)

        // She is in the centre's own frame, not standing in a row of relatives — and Ankit has no
        // brothers or sisters, so the absence of that row is what proves where she is.
        rule.onNodeWithTag(compactPersonTag(priya.id)).assertIsDisplayed()
        rule.onAllNodesWithText("SIBLINGS").assertCountEquals(0)
    }

    @Test
    fun tappingSomebodyWalksTheWholeViewOntoThem() {
        seedFamily()
        centreOn(ankit)
        openCompact()
        waitForCentre(ankit)
        waitForCard(vinod)

        rule.onNodeWithTag(compactPersonTag(vinod.id)).performClick()
        waitForCentre(vinod)

        // Ankit was the centre a moment ago and is now where he belongs: one generation down.
        waitForCard(ankit)
    }

    @Test
    fun everyWalkIsUndoneByOneTapInTheBandItCameFrom() {
        seedFamily()
        centreOn(ankit)
        openCompact()
        waitForCentre(ankit)
        waitForCard(vinod)

        rule.onNodeWithTag(compactPersonTag(vinod.id)).performClick()
        waitForCentre(vinod)

        // No history is kept and none is needed: if he is now above you, you are now below him.
        waitForCard(ankit)
        rule.onNodeWithTag(compactPersonTag(ankit.id)).performClick()
        waitForCentre(ankit)
    }

    @Test
    fun theChartFollowsWhereTheCompactViewWalkedTo() {
        seedFamily()
        centreOn(ankit)
        openCompact()
        waitForCentre(ankit)
        waitForCard(vinod)

        rule.onNodeWithTag(compactPersonTag(vinod.id)).performClick()
        waitForCentre(vinod)

        rule.onNodeWithTag(TreeModeFocusedTag).performClick()
        rule.waitUntil(10_000) {
            rule.onAllNodesWithTag(FamilyChartTag).fetchSemanticsNodes().isNotEmpty()
        }

        // One focus behind both views, so they are two renderings of one thing rather than two
        // places to get lost in.
        rule.onNodeWithContentDescription("centred on Vinod Kumar", substring = true)
            .assertIsDisplayed()
    }

    @Test
    fun theCentreOpensTheSameActionsTheChartsOffer() {
        seedFamily()
        openCompact()

        rule.onNodeWithTag(CompactFocusTag).performClick()
        rule.waitUntil(10_000) {
            rule.onAllNodesWithTag(TreeOpenPersonTag).fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag(TreeOpenPersonTag).assertIsDisplayed()
    }

    @Test
    fun aGenerationNobodyHasRecordedIsAnInvitationRatherThanASilence() {
        val repository = app.container.familyRepository
        val alone = Person(name = "Ankit Kumar", birthDate = "1990")
        val firstborn = Person(name = "Aarav Kumar", birthDate = "2018")
        runBlocking {
            listOf(alone, firstborn).forEach { repository.addPerson(it) }
            repository.addRelative(alone.id, firstborn.id, RelativeKind.CHILD)
        }
        rule.waitUntil(10_000) {
            rule.onAllNodesWithTag(FamilyChartTag).fetchSemanticsNodes().isNotEmpty()
        }
        centreOn(alone)
        openCompact()
        waitForCentre(alone)

        // Nobody has written down his parents. The heading still appears, because an empty rule
        // reads as "not recorded yet" while a missing one reads as "not supported".
        rule.waitUntil(10_000) {
            rule.onAllNodesWithTag(compactAddTag(RelativeKind.PARENT)).fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithText("PARENTS").assertIsDisplayed()
        rule.onNodeWithTag(compactAddTag(RelativeKind.PARENT)).assertIsDisplayed()
    }
}
