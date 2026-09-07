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
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.MainActivity
import com.vibethroughcode.ftree.data.Gender
import com.vibethroughcode.ftree.data.KinshipLanguage
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.data.RelativeKind
import com.vibethroughcode.ftree.ui.relation.RelationAnswerTag
import com.vibethroughcode.ftree.ui.relation.RelationPickListTag
import com.vibethroughcode.ftree.ui.relation.RelationPickSearchTag
import com.vibethroughcode.ftree.ui.relation.RelationSlotFromTag
import com.vibethroughcode.ftree.ui.relation.RelationSlotToTag
import com.vibethroughcode.ftree.ui.settings.SettingsWordsEnglishTag
import com.vibethroughcode.ftree.ui.settings.SettingsWordsHindiTag
import com.vibethroughcode.ftree.ui.tree.FamilyChartTag
import com.vibethroughcode.ftree.ui.tree.TreeRelateTag
import kotlinx.coroutines.runBlocking
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * The family-words setting, end to end.
 *
 * Which Hindi word applies is settled on the JVM, over every pair of two whole families. What is
 * worth an emulator is the join: that the setting reaches the sentence, that the same two people
 * read differently once it is flipped, and that a relationship the record cannot pin down says so
 * rather than guessing.
 */
@RunWith(AndroidJUnit4::class)
class HindiRelationTest {

    @get:Rule
    val rule = createAndroidComposeRule<MainActivity>()

    private val app: FTreeApplication
        get() = InstrumentationRegistry.getInstrumentation()
            .targetContext.applicationContext as FTreeApplication

    @Before
    fun emptyTheTree() {
        app.container.kinshipPreferences.setLanguage(KinshipLanguage.ENGLISH)
        app.container.database.clearAllTables()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText("Build your family tree").fetchSemanticsNodes().isNotEmpty()
        }
    }

    /**
     * A mother's brother and a father's brother, the pair English calls "uncle" twice.
     *
     * The father and his brother carry birth years so one of them is provably the younger; the
     * whole point of [aBrotherWithNoBirthYearIsNamedDescriptively] is what happens when they do not.
     */
    private fun seedBothUncles() {
        val repository = app.container.familyRepository
        runBlocking {
            val nana = Person(name = "Ram Pher", gender = Gender.MALE, birthDate = "1930")
            val dada = Person(name = "Shyam Lal", gender = Gender.MALE, birthDate = "1928")
            val mum = Person(name = "Pragya Devi", gender = Gender.FEMALE, birthDate = "1960")
            val mamaPerson = Person(name = "Kinshuk Kumar", gender = Gender.MALE, birthDate = "1958")
            val dad = Person(name = "Sandeep Kumar", gender = Gender.MALE, birthDate = "1956")
            val chacha = Person(name = "Vinod Kumar", gender = Gender.MALE, birthDate = "1962")
            val me = Person(name = "Ankit Kumar", gender = Gender.MALE, birthDate = "1990")
            listOf(nana, dada, mum, mamaPerson, dad, chacha, me)
                .forEach { repository.addPerson(it) }
            repository.addRelative(mum.id, nana.id, RelativeKind.PARENT)
            repository.addRelative(mamaPerson.id, nana.id, RelativeKind.PARENT)
            repository.addRelative(dad.id, dada.id, RelativeKind.PARENT)
            repository.addRelative(chacha.id, dada.id, RelativeKind.PARENT)
            repository.addRelative(me.id, mum.id, RelativeKind.PARENT)
            repository.addRelative(me.id, dad.id, RelativeKind.PARENT)
        }
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(FamilyChartTag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun chooseLanguage(tag: String) {
        rule.onNodeWithTag(NavSettingsTag).performClick()
        rule.waitUntil(5_000) { rule.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
        rule.onNodeWithTag(tag).performClick()
        rule.onNodeWithTag(NavTreeTag).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(FamilyChartTag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun pick(slotTag: String, name: String) {
        rule.onNodeWithTag(slotTag).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(RelationPickSearchTag).fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag(RelationPickSearchTag).performTextInput(name)
        val row = hasText(name) and hasAnyAncestor(hasTestTag(RelationPickListTag))
        rule.waitUntil(5_000) { rule.onAllNodes(row).fetchSemanticsNodes().isNotEmpty() }
        rule.onNode(row).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(RelationSlotFromTag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun relate(from: String, to: String) {
        rule.onNodeWithTag(TreeRelateTag).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(RelationSlotFromTag).fetchSemanticsNodes().isNotEmpty()
        }
        pick(RelationSlotFromTag, from)
        pick(RelationSlotToTag, to)
    }

    private fun awaitText(text: String) {
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText(text, substring = true).fetchSemanticsNodes().isNotEmpty()
        }
        rule.onAllNodesWithText(text, substring = true)[0].assertIsDisplayed()
    }

    /**
     * The case that prompted the feature. English calls both men "uncle"; Hindi calls one मामा and
     * the other चाचा, and only one of those is right for either of them.
     */
    @Test
    fun theTwoUnclesEnglishCallsTheSameThingAreNamedApartInHindi() {
        seedBothUncles()
        chooseLanguage(SettingsWordsHindiTag)

        relate(from = "Ankit Kumar", to = "Kinshuk Kumar")
        awaitText("मामा")

        // Changing one of the two means reaching under the fold: with an answer on screen the
        // sheet shows the sentence, and the pair it was worked out from is a drag below it.
        rule.onNodeWithTag(RelationAnswerTag).performTouchInput {
            swipeUp(startY = center.y, endY = center.y - 1_200f, durationMillis = 300)
        }
        rule.waitForIdle()
        rule.onNodeWithTag(RelationSlotToTag).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(RelationPickSearchTag).fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithTag(RelationPickSearchTag).performTextInput("Vinod Kumar")
        val row = hasText("Vinod Kumar") and hasAnyAncestor(hasTestTag(RelationPickListTag))
        rule.waitUntil(5_000) { rule.onAllNodes(row).fetchSemanticsNodes().isNotEmpty() }
        rule.onNode(row).performClick()

        // Born after the father, so provably the younger brother — चाचा rather than ताऊ.
        awaitText("चाचा")
    }

    /** The English gloss rides along, so a reader who does not know the word is not stuck. */
    @Test
    fun theHindiWordCarriesItsMeaningInBrackets() {
        seedBothUncles()
        chooseLanguage(SettingsWordsHindiTag)

        relate(from = "Ankit Kumar", to = "Kinshuk Kumar")

        awaitText("मामा (mother's brother)")
    }

    /** And the setting really is a setting: the same pair reads in English when English is chosen. */
    @Test
    fun theSamePairReadsInEnglishWhenEnglishIsChosen() {
        seedBothUncles()
        chooseLanguage(SettingsWordsEnglishTag)

        relate(from = "Ankit Kumar", to = "Kinshuk Kumar")

        awaitText("uncle")
        rule.onAllNodesWithText("मामा", substring = true).fetchSemanticsNodes().let {
            assert(it.isEmpty()) { "a Hindi word appeared while the setting said English" }
        }
    }

    /**
     * ताऊ is an elder brother and चाचा a younger one. With no birth years the record cannot say, so
     * the app names him descriptively and offers the way to sharpen it rather than picking one.
     */
    @Test
    fun aBrotherWithNoBirthYearIsNamedDescriptively() {
        val repository = app.container.familyRepository
        runBlocking {
            val dada = Person(name = "Shyam Lal", gender = Gender.MALE)
            val dad = Person(name = "Sandeep Kumar", gender = Gender.MALE)
            val uncle = Person(name = "Vinod Kumar", gender = Gender.MALE)
            val me = Person(name = "Ankit Kumar", gender = Gender.MALE)
            listOf(dada, dad, uncle, me).forEach { repository.addPerson(it) }
            repository.addRelative(dad.id, dada.id, RelativeKind.PARENT)
            repository.addRelative(uncle.id, dada.id, RelativeKind.PARENT)
            repository.addRelative(me.id, dad.id, RelativeKind.PARENT)
        }
        rule.waitUntil(5_000) {
            rule.onAllNodesWithTag(FamilyChartTag).fetchSemanticsNodes().isNotEmpty()
        }
        chooseLanguage(SettingsWordsHindiTag)

        relate(from = "Ankit Kumar", to = "Vinod Kumar")

        awaitText("पिता के भाई")
        // …and says what would settle it.
        awaitText("Birth years")
    }

    /** Headings on a person's page follow the setting too, so the app speaks with one voice. */
    @Test
    fun theHeadingsOnAPersonsPageFollowTheSetting() {
        seedBothUncles()
        chooseLanguage(SettingsWordsHindiTag)

        rule.onNodeWithTag(NavPeopleTag).performClick()
        rule.waitUntil(5_000) {
            rule.onAllNodesWithText("Ankit Kumar").fetchSemanticsNodes().isNotEmpty()
        }
        rule.onNodeWithText("Ankit Kumar").performClick()

        awaitText("पिता")
        awaitText("माता")
    }
}
