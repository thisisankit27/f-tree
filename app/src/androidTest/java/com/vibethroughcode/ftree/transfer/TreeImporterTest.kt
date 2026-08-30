package com.vibethroughcode.ftree.transfer

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.vibethroughcode.ftree.data.FTreeDatabase
import com.vibethroughcode.ftree.data.FamilyRepository
import com.vibethroughcode.ftree.data.Gender
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.data.PhotoStore
import com.vibethroughcode.ftree.data.RelativeKind
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * The most important behaviour in the app: importing a tree must add to yours, never replace it.
 *
 * Two independent databases stand in for two phones. One exports; the other imports.
 */
@RunWith(AndroidJUnit4::class)
class TreeImporterTest {

    private lateinit var context: Context
    private lateinit var mine: Side
    private lateinit var theirs: Side
    private lateinit var workingDirectory: File

    /** One person's device: a database, a photo store, and the transfer machinery over them. */
    private class Side(
        val db: FTreeDatabase,
        val repository: FamilyRepository,
        val photos: PhotoStore,
        val identity: TreeIdentity,
        val exporter: TreeExporter,
    )

    private fun side(context: Context, treeId: String): Side {
        val db = Room.inMemoryDatabaseBuilder(context, FTreeDatabase::class.java)
            .addCallback(FTreeDatabase.enforceForeignKeys)
            .build()
        val photos = PhotoStore(context)
        val repository = FamilyRepository(db, photos)
        val identity = FixedIdentity(context, treeId)
        return Side(db, repository, photos, identity, TreeExporter(repository, photos, identity))
    }

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        workingDirectory = File(context.cacheDir, "import-test").apply {
            deleteRecursively(); mkdirs()
        }
        mine = side(context, "my-tree")
        theirs = side(context, "their-tree")
    }

    @After
    fun tearDown() {
        mine.db.close()
        theirs.db.close()
        workingDirectory.deleteRecursively()
        File(context.filesDir, PhotoStore.DIRECTORY).deleteRecursively()
    }

    private fun importerFor(side: Side) = TreeImporter(
        database = side.db,
        repository = side.repository,
        photos = side.photos,
        identity = side.identity,
        exporter = side.exporter,
        workingDirectory = workingDirectory,
    )

    private suspend fun exportOf(side: Side): ByteArray =
        ByteArrayOutputStream().also { side.exporter.exportTo(it) }.toByteArray()

    /** Runs a whole import with the plan's own default decisions. */
    private suspend fun importInto(side: Side, archive: ByteArray): ImportResult {
        val importer = importerFor(side)
        val plan = importer.prepare(archive.inputStream())
        return importer.apply(plan, plan.defaultDecisions)
    }

    private suspend fun namesIn(side: Side): List<String?> =
        side.repository.observeAllPeople().first().map { it.name }

    // ------------------------------------------------------------------

    @Test
    fun importingIntoAnEmptyTreeReproducesTheOriginal() = runTest {
        val father = Person(name = "Raj Kumar", birthDate = "1938")
        val me = Person(name = "Ankit Kumar", birthDate = "1990")
        listOf(father, me).forEach { theirs.repository.addPerson(it) }
        theirs.repository.addRelative(me.id, father.id, RelativeKind.PARENT)

        val result = importInto(mine, exportOf(theirs))

        assertEquals(2, result.peopleAdded)
        assertEquals(1, result.relationshipsAdded)
        assertEquals(setOf("Raj Kumar", "Ankit Kumar"), namesIn(mine).toSet())
    }

    @Test
    fun myOwnPeopleAreNotTouchedByAnImport() = runTest {
        val myFather = Person(name = "Vinod Kumar", birthDate = "1962")
        val me = Person(name = "Ankit Kumar", birthDate = "1990")
        listOf(myFather, me).forEach { mine.repository.addPerson(it) }
        mine.repository.addRelative(me.id, myFather.id, RelativeKind.PARENT)

        // An entirely unrelated family.
        listOf(Person(name = "Her Father"), Person(name = "Priya Sharma")).forEach {
            theirs.repository.addPerson(it)
        }

        importInto(mine, exportOf(theirs))

        // Everything that was mine is still exactly as it was, plus theirs.
        assertEquals(4, mine.repository.allPeople().size)
        assertTrue(namesIn(mine).containsAll(listOf("Vinod Kumar", "Ankit Kumar")))
        val stillMyFather = mine.repository.observeParents(me.id).first().single()
        assertEquals("Vinod Kumar", stillMyFather.name)
    }

    @Test
    fun importingTheSameFileTwiceChangesNothingTheSecondTime() = runTest {
        listOf(Person(name = "Raj Kumar", birthDate = "1938"), Person(name = "Priya", birthDate = "1992"))
            .forEach { theirs.repository.addPerson(it) }
        val archive = exportOf(theirs)

        val first = importInto(mine, archive)
        val countAfterFirst = mine.repository.allPeople().size
        val second = importInto(mine, archive)

        assertEquals(2, first.peopleAdded)
        // The origins recorded by the first import make the second recognise everybody outright.
        assertEquals(0, second.peopleAdded)
        assertEquals(2, second.peopleMerged)
        assertEquals(countAfterFirst, mine.repository.allPeople().size)
    }

    @Test
    fun reImportingMyOwnExportIsANoOp() = runTest {
        val me = Person(name = "Ankit Kumar", birthDate = "1990")
        val father = Person(name = "Vinod Kumar", birthDate = "1962")
        listOf(me, father).forEach { mine.repository.addPerson(it) }
        mine.repository.addRelative(me.id, father.id, RelativeKind.PARENT)

        val result = importInto(mine, exportOf(mine))

        assertEquals(0, result.peopleAdded)
        assertEquals(2, result.peopleMerged)
        assertEquals(2, mine.repository.allPeople().size)
        assertEquals(1, mine.repository.allRelationships().size)
    }

    @Test
    fun aMergeFillsGapsAndNeverOverwrites() = runTest {
        // Mine knows the name only; theirs knows the dates and disagrees about the notes.
        val localId = "shared"
        mine.repository.addPerson(Person(id = localId, name = "Raj Kumar", notes = "my note"))
        theirs.repository.addPerson(
            Person(
                id = "remote",
                name = "Raj Kumar",
                gender = Gender.MALE,
                birthDate = "1938",
                deathDate = "2010",
                deceased = true,
                notes = "their note",
            )
        )

        val importer = importerFor(mine)
        val plan = importer.prepare(exportOf(theirs).inputStream())
        // Same name only, so it is offered but not merged by default; the user says yes.
        val result = importer.apply(plan, mapOf("remote" to true))

        val merged = mine.repository.person(localId)!!
        assertEquals(1, result.peopleMerged)
        assertEquals("1938", merged.birthDate)
        assertEquals("2010", merged.deathDate)
        assertEquals(Gender.MALE, merged.gender)
        // The value that was already here wins, and the disagreement is reported.
        assertEquals("my note", merged.notes)
        assertEquals(1, result.conflicts.size)
        assertEquals("notes", result.conflicts.single().field)
    }

    @Test
    fun aWeakMatchIsKeptSeparateUnlessAskedFor() = runTest {
        mine.repository.addPerson(Person(name = "Ankit Kumar"))
        theirs.repository.addPerson(Person(name = "Ankit Kumar"))

        val result = importInto(mine, exportOf(theirs))

        // Two people sharing a name is not evidence enough to collapse them.
        assertEquals(1, result.peopleAdded)
        assertEquals(0, result.peopleMerged)
        assertEquals(2, mine.repository.allPeople().size)
    }

    @Test
    fun theWifesFamilyJoinsMineThroughThePersonWeShare() = runTest {
        // My tree: my father, me, and my wife.
        val me = Person(id = "me", name = "Ankit Kumar", birthDate = "1990")
        val myFather = Person(id = "my-father", name = "Vinod Kumar", birthDate = "1962")
        val wifeHere = Person(id = "wife-here", name = "Priya Sharma", birthDate = "1992")
        listOf(me, myFather, wifeHere).forEach { mine.repository.addPerson(it) }
        mine.repository.addRelative(me.id, myFather.id, RelativeKind.PARENT)
        mine.repository.addRelative(me.id, wifeHere.id, RelativeKind.SPOUSE)

        // Her tree: her parents and herself.
        val wifeThere = Person(id = "wife-there", name = "Priya Sharma", birthDate = "1992")
        val herFather = Person(id = "her-father", name = "Suresh Sharma", birthDate = "1960")
        val herMother = Person(id = "her-mother", name = "Kavita Sharma", birthDate = "1964")
        listOf(wifeThere, herFather, herMother).forEach { theirs.repository.addPerson(it) }
        theirs.repository.addRelative(wifeThere.id, herFather.id, RelativeKind.PARENT)
        theirs.repository.addRelative(wifeThere.id, herMother.id, RelativeKind.PARENT)

        val importer = importerFor(mine)
        val plan = importer.prepare(exportOf(theirs).inputStream())
        // She is the person both trees hold; the user confirms it.
        val result = importer.apply(plan, plan.defaultDecisions + ("wife-there" to true))

        assertEquals(2, result.peopleAdded)
        assertEquals(1, result.peopleMerged)

        // Her parents now hang off the wife who was already in my tree, and my side is untouched.
        val herParents = mine.repository.observeParents("wife-here").first().map { it.name }
        assertEquals(setOf("Suresh Sharma", "Kavita Sharma"), herParents.toSet())
        assertEquals("Vinod Kumar", mine.repository.observeParents("me").first().single().name)
        assertEquals("Priya Sharma", mine.repository.observeSpouses("me").first().single().name)
    }

    @Test
    fun importedIdsAreRemappedSoTheyCannotCollide() = runTest {
        // Both trees happen to use the same id for completely different people.
        mine.repository.addPerson(Person(id = "same-id", name = "Ankit Kumar"))
        theirs.repository.addPerson(Person(id = "same-id", name = "Somebody Else"))

        importInto(mine, exportOf(theirs))

        assertEquals(2, mine.repository.allPeople().size)
        assertEquals("Ankit Kumar", mine.repository.person("same-id")!!.name)
        assertTrue(namesIn(mine).contains("Somebody Else"))
    }

    @Test
    fun aRelationshipAlreadyRecordedIsNotDuplicated() = runTest {
        val me = Person(id = "me", name = "Ankit Kumar", birthDate = "1990")
        val father = Person(id = "father", name = "Vinod Kumar", birthDate = "1962")
        listOf(me, father).forEach {
            mine.repository.addPerson(it)
            theirs.repository.addPerson(it)
        }
        mine.repository.addRelative("me", "father", RelativeKind.PARENT)
        theirs.repository.addRelative("me", "father", RelativeKind.PARENT)

        val importer = importerFor(mine)
        val plan = importer.prepare(exportOf(theirs).inputStream())
        val result = importer.apply(plan, mapOf("me" to true, "father" to true))

        assertEquals(0, result.relationshipsAdded)
        assertEquals(1, result.relationshipsAlreadyPresent)
        assertEquals(1, mine.repository.allRelationships().size)
    }

    @Test
    fun unknownPeopleArriveAsRealNodes() = runTest {
        val child = Person(name = "Aarav", birthDate = "2020")
        val unknownParent = Person()
        listOf(child, unknownParent).forEach { theirs.repository.addPerson(it) }
        theirs.repository.addRelative(child.id, unknownParent.id, RelativeKind.PARENT)

        val result = importInto(mine, exportOf(theirs))

        assertEquals(2, result.peopleAdded)
        val imported = mine.repository.allPeople().single { it.isUnnamed }
        assertNotNull(imported)
        // The placeholder keeps its place in the family rather than being dropped as empty.
        assertEquals(1, mine.repository.observeChildren(imported.id).first().size)
    }

    @Test
    fun aFileThatIsNotAnArchiveIsRefused() = runTest {
        val failure = runCatching {
            importerFor(mine).prepare("this is not a zip".toByteArray().inputStream())
        }.exceptionOrNull()

        assertTrue(failure is ImportFailure)
        assertEquals(0, mine.repository.allPeople().size)
    }

    @Test
    fun aFileFromANewerVersionIsRefusedRatherThanPartlyUnderstood() = runTest {
        val archive = ByteArrayOutputStream().use { out ->
            java.util.zip.ZipOutputStream(out).use { zip ->
                zip.putNextEntry(java.util.zip.ZipEntry(TreeDocument.ENTRY_JSON))
                zip.write("""{"format":"f-tree","version":99,"people":[{"id":"p"}]}""".toByteArray())
                zip.closeEntry()
            }
            out.toByteArray()
        }

        val failure = runCatching {
            importerFor(mine).prepare(archive.inputStream())
        }.exceptionOrNull() as? ImportFailure

        assertEquals(ImportProblem.FROM_A_NEWER_VERSION, failure?.problem)
    }

    @Test
    fun backingOutOfAnImportLeavesTheTreeUntouched() = runTest {
        mine.repository.addPerson(Person(name = "Ankit Kumar"))
        theirs.repository.addPerson(Person(name = "Somebody New"))

        val importer = importerFor(mine)
        val plan = importer.prepare(exportOf(theirs).inputStream())
        importer.discard(plan)

        assertEquals(1, mine.repository.allPeople().size)
        assertNull(namesIn(mine).firstOrNull { it == "Somebody New" })
    }

    @Test
    fun aBackupIsWrittenBeforeAnythingChanges() = runTest {
        mine.repository.addPerson(Person(name = "Ankit Kumar"))
        theirs.repository.addPerson(Person(name = "Somebody New"))

        val result = importInto(mine, exportOf(theirs))

        assertNotNull(result.backup)
        assertTrue(result.backup!!.exists())
        assertTrue(result.backup!!.length() > 0)
    }
}

/** A tree identity pinned to a known value, so two simulated devices stay distinguishable. */
private class FixedIdentity(context: Context, private val fixed: String) : TreeIdentity(context) {
    override val treeId: String get() = fixed
}
