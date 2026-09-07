package com.vibethroughcode.ftree.transfer

import android.content.Intent
import android.net.Uri
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.vibethroughcode.ftree.BuildConfig
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.Gender
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.data.RelativeKind
import com.vibethroughcode.ftree.graph.Kinship
import com.vibethroughcode.ftree.graph.KinshipTerm
import com.vibethroughcode.ftree.graph.Relation
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Sharing one person's family, and joining it to somebody else's tree.
 *
 * This is the whole point of the feature and it only means anything end to end: a branch written on
 * one device has to arrive on another as people who can be married into an existing family and
 * reasoned about afterwards. So the test does the real round trip — export the branch, wipe the
 * tree, import the file, connect it — and then asks the relation finder questions it could only
 * answer if every edge survived.
 */
@RunWith(AndroidJUnit4::class)
class ShareBranchTest {

    private val app: FTreeApplication
        get() = InstrumentationRegistry.getInstrumentation()
            .targetContext.applicationContext as FTreeApplication

    private val repository get() = app.container.familyRepository
    private val resolver get() = app.applicationContext.contentResolver

    @Before
    fun emptyTheTree() {
        app.container.database.clearAllTables()
    }

    private fun person(name: String, gender: Gender, born: String? = null) =
        Person(name = name, gender = gender, birthDate = born)

    /**
     * Sandeep's household, inside a larger family.
     *
     * His father and his brother exist so the test can prove they stay behind: a share that quietly
     * carried the sharer's parents and siblings would be handing over far more than was offered.
     */
    private data class Seeded(
        val sandeep: Person, val pragya: Person, val ankit: Person, val sarika: Person,
        val father: Person, val brother: Person,
    )

    private fun seedSandeepsFamily(): Seeded = runBlocking {
        val sandeep = person("Sandeep Kumar", Gender.MALE, "1965")
        val pragya = person("Pragya Kumar", Gender.FEMALE, "1968")
        val ankit = person("Ankit Kumar", Gender.MALE, "1992")
        val sarika = person("Sarika Kumar", Gender.FEMALE, "1995")
        val father = person("Shushil Kumar", Gender.MALE, "1938")
        val brother = person("Rajesh Kumar", Gender.MALE, "1970")
        listOf(sandeep, pragya, ankit, sarika, father, brother).forEach { repository.addPerson(it) }

        repository.addRelative(sandeep.id, pragya.id, RelativeKind.SPOUSE)
        repository.addRelative(sandeep.id, ankit.id, RelativeKind.CHILD)
        repository.addRelative(pragya.id, ankit.id, RelativeKind.CHILD)
        repository.addRelative(sandeep.id, sarika.id, RelativeKind.CHILD)
        repository.addRelative(pragya.id, sarika.id, RelativeKind.CHILD)
        repository.addRelative(sandeep.id, father.id, RelativeKind.PARENT)
        repository.addRelative(brother.id, father.id, RelativeKind.PARENT)
        Seeded(sandeep, pragya, ankit, sarika, father, brother)
    }

    private fun shareBranchOf(personId: String): ByteArray = runBlocking {
        val shared = app.container.branchShare.prepare(personId)
        assertNotNull("nothing was written to share", shared)
        resolver.openInputStream(shared!!.uri)!!.use { it.readBytes() }
    }

    private fun importInto(archive: ByteArray) = runBlocking {
        val plan = app.container.importer.prepare(archive.inputStream())
        app.container.importer.apply(plan, plan.defaultDecisions)
    }

    private suspend fun namesInTree(): Set<String?> =
        repository.observeAllPeople().first().map { it.name }.toSet()

    private suspend fun idOf(name: String): String =
        repository.observeAllPeople().first().first { it.name == name }.id

    private suspend fun relate(fromName: String, toName: String): Relation {
        val graph = repository.observeWholeGraph().first()
        return Kinship.relate(graph, idOf(fromName), idOf(toName))
    }

    @Test
    fun aSharedBranchCarriesTheHouseholdAndNothingAbove() {
        val seeded = seedSandeepsFamily()
        val archive = shareBranchOf(seeded.sandeep.id)

        runBlocking { app.container.database.clearAllTables() }
        importInto(archive)

        runBlocking {
            assertEquals(
                setOf("Sandeep Kumar", "Pragya Kumar", "Ankit Kumar", "Sarika Kumar"),
                namesInTree(),
            )
        }
    }

    @Test
    fun theRelationshipsInsideTheBranchSurviveTheJourney() {
        val seeded = seedSandeepsFamily()
        val archive = shareBranchOf(seeded.sandeep.id)
        runBlocking { app.container.database.clearAllTables() }
        importInto(archive)

        runBlocking {
            // The marriage.
            assertEquals(KinshipTerm.Spouse, (relate("Sandeep Kumar", "Pragya Kumar") as Relation.Found).term)
            // Both children, through both parents.
            listOf("Ankit Kumar", "Sarika Kumar").forEach { child ->
                val found = relate("Sandeep Kumar", child) as Relation.Found
                assertEquals(KinshipTerm.Descendant(1), found.term)
                assertEquals(KinshipTerm.Descendant(1), (relate("Pragya Kumar", child) as Relation.Found).term)
            }
            // And the siblings the import had to derive rather than read.
            assertEquals(
                KinshipTerm.Sibling,
                (relate("Ankit Kumar", "Sarika Kumar") as Relation.Found).term,
            )
        }
    }

    /**
     * The reason to want this: somebody sends you their family, you import it, and you marry into
     * it. Every question afterwards has to be answerable across the join.
     */
    @Test
    fun animportedBranchCanBeMarriedIntoAnExistingTree() {
        val seeded = seedSandeepsFamily()
        val archive = shareBranchOf(seeded.sandeep.id)

        // A different device, with a tree of its own.
        runBlocking { app.container.database.clearAllTables() }
        val me = person("Ankit Srivastava", Gender.MALE, "1990")
        val myFather = person("Vinod Srivastava", Gender.MALE, "1962")
        runBlocking {
            listOf(me, myFather).forEach { repository.addPerson(it) }
            repository.addRelative(me.id, myFather.id, RelativeKind.PARENT)
        }

        importInto(archive)

        runBlocking {
            // Six people now: my two and their four, still separate.
            assertEquals(6, repository.observeAllPeople().first().size)
            assertTrue(relate("Ankit Srivastava", "Sarika Kumar") is Relation.Unrecorded)

            // Marry her.
            repository.addRelative(me.id, idOf("Sarika Kumar"), RelativeKind.SPOUSE)

            assertEquals(
                KinshipTerm.Spouse,
                (relate("Ankit Srivastava", "Sarika Kumar") as Relation.Found).term,
            )
            // Her father is now my father-in-law, which is a relationship the app can only name if
            // the imported edges and the new one are read as one graph.
            val fatherInLaw = relate("Ankit Srivastava", "Sandeep Kumar") as Relation.Found
            assertEquals(KinshipTerm.OfSpouse(KinshipTerm.Ancestor(1)), fatherInLaw.term)
            val motherInLaw = relate("Ankit Srivastava", "Pragya Kumar") as Relation.Found
            assertEquals(KinshipTerm.OfSpouse(KinshipTerm.Ancestor(1)), motherInLaw.term)
            // And her brother my brother-in-law.
            val brotherInLaw = relate("Ankit Srivastava", "Ankit Kumar") as Relation.Found
            assertEquals(KinshipTerm.OfSpouse(KinshipTerm.Sibling), brotherInLaw.term)

            // My own side still reads correctly, and reaches across the marriage.
            assertEquals(
                KinshipTerm.Ancestor(1),
                (relate("Ankit Srivastava", "Vinod Srivastava") as Relation.Found).term,
            )
            assertTrue(relate("Vinod Srivastava", "Sandeep Kumar") is Relation.Found)
        }
    }

    @Test
    fun sharingTheSamePersonTwiceIsRecognisedRatherThanDuplicated() {
        val seeded = seedSandeepsFamily()
        val archive = shareBranchOf(seeded.sandeep.id)
        runBlocking { app.container.database.clearAllTables() }

        importInto(archive)
        importInto(archive)

        runBlocking {
            // The same file twice is the same four people, not eight: every record carries where it
            // came from, so the second import recognises them outright.
            assertEquals(4, repository.observeAllPeople().first().size)
        }
    }

    @Test
    fun somebodyWithNobodyBelowThemStillHasAFamilyToSend() {
        val seeded = seedSandeepsFamily()
        val archive = shareBranchOf(seeded.sarika.id)
        runBlocking { app.container.database.clearAllTables() }
        importInto(archive)

        runBlocking {
            // Sarika alone: no children, and no partner to bring.
            assertEquals(setOf("Sarika Kumar"), namesInTree())
            assertNull(repository.observeAllPeople().first().single().birthDate?.let { null })
        }
    }

    /**
     * What actually leaves the app.
     *
     * The message is assembled from three pieces of copy and two numbers, and a format argument in
     * the wrong order is the sort of thing nobody notices until it is in somebody's chat window.
     */
    @Test
    fun theIntentCarriesTheFileAndAMessageThatNamesTheFamily() {
        val seeded = seedSandeepsFamily()
        val shared = runBlocking { app.container.branchShare.prepare(seeded.sandeep.id) }!!

        assertEquals("Sandeep Kumar", shared.personName)
        assertEquals(4, shared.people)

        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val message = context.getString(
            R.string.share_message,
            shared.personName,
            context.resources.getQuantityString(R.plurals.person_count, shared.people, shared.people),
            BuildConfig.SITE_URL,
        )
        val intent = sendBranchIntent(shared.uri, message, "Send Sandeep Kumar's family")

        assertEquals(Intent.ACTION_SEND, intent.action)
        assertEquals(TreeDocument.MIME_TYPE, intent.type)
        assertEquals(shared.uri, intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java))
        assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)

        val text = intent.getStringExtra(Intent.EXTRA_TEXT)!!
        assertTrue("should name whose family it is: $text", "Sandeep Kumar" in text)
        assertTrue("should say how many people: $text", "4 people" in text)
        assertTrue("should say where to get the app: $text", BuildConfig.SITE_URL in text)
    }
}
