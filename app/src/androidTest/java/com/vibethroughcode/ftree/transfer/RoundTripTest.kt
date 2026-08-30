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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.ByteArrayOutputStream
import java.io.File

/**
 * A whole family out through the file and back in, checked person by person.
 *
 * The individual pieces are tested elsewhere; this is the promise the user actually cares about —
 * that a tree written to a file and read back somewhere else is still the same family, including
 * the parts nobody managed to fill in.
 */
@RunWith(AndroidJUnit4::class)
class RoundTripTest {

    private lateinit var context: Context
    private lateinit var source: FTreeDatabase
    private lateinit var destination: FTreeDatabase
    private lateinit var from: FamilyRepository
    private lateinit var into: FamilyRepository
    private lateinit var photos: PhotoStore
    private lateinit var working: File

    @Before
    fun setUp() {
        context = ApplicationProvider.getApplicationContext()
        photos = PhotoStore(context)
        working = File(context.cacheDir, "round-trip").apply { deleteRecursively(); mkdirs() }
        source = inMemory()
        destination = inMemory()
        from = FamilyRepository(source, photos)
        into = FamilyRepository(destination, photos)
    }

    private fun inMemory() = Room.inMemoryDatabaseBuilder(context, FTreeDatabase::class.java)
        .addCallback(FTreeDatabase.enforceForeignKeys)
        .build()

    @After
    fun tearDown() {
        source.close()
        destination.close()
        working.deleteRecursively()
        File(context.filesDir, PhotoStore.DIRECTORY).deleteRecursively()
    }

    @Test
    fun aFamilyGoesOutThroughAFileAndComesBackTheSame() = runTest {
        // Three generations, two marriages, a half-sibling, and two people nobody could name.
        val grandfather = Person(name = "Shyam Lal", gender = Gender.MALE, birthDate = "1905", deathDate = "1978", deceased = true)
        val grandmother = Person()
        val father = Person(name = "Raj Kumar", gender = Gender.MALE, birthDate = "1938")
        val firstWife = Person(name = "Sushila Devi", gender = Gender.FEMALE, birthDate = "1942")
        val secondWife = Person(name = "Meena", gender = Gender.FEMALE, birthDate = "1950")
        val me = Person(name = "Ankit Kumar", gender = Gender.MALE, birthDate = "1990-05-01", notes = "eldest")
        val halfBrother = Person(name = "Rohit", gender = Gender.MALE, birthDate = "1995")
        val unknownRelative = Person()

        listOf(grandfather, grandmother, father, firstWife, secondWife, me, halfBrother, unknownRelative)
            .forEach { from.addPerson(it) }

        from.addRelative(father.id, grandfather.id, RelativeKind.PARENT)
        from.addRelative(father.id, grandmother.id, RelativeKind.PARENT)
        from.addRelative(grandfather.id, grandmother.id, RelativeKind.SPOUSE)
        from.addRelative(father.id, firstWife.id, RelativeKind.SPOUSE)
        from.addRelative(father.id, secondWife.id, RelativeKind.SPOUSE)
        from.addRelative(me.id, father.id, RelativeKind.PARENT)
        from.addRelative(me.id, firstWife.id, RelativeKind.PARENT)
        from.addRelative(halfBrother.id, father.id, RelativeKind.PARENT)
        from.addRelative(halfBrother.id, secondWife.id, RelativeKind.PARENT)
        from.addRelative(me.id, unknownRelative.id, RelativeKind.CHILD)

        val identity = TreeIdentity(context)
        val exporter = TreeExporter(from, photos, identity)
        val archive = ByteArrayOutputStream().also { exporter.exportTo(it) }.toByteArray()

        val importer = TreeImporter(
            database = destination,
            repository = into,
            photos = photos,
            identity = TreeIdentity(context),
            exporter = TreeExporter(into, photos, TreeIdentity(context)),
            workingDirectory = working,
        )
        val plan = importer.prepare(archive.inputStream())
        val result = importer.apply(plan, plan.defaultDecisions)

        assertEquals(8, result.peopleAdded)
        assertEquals(from.allRelationships().size, result.relationshipsAdded)

        // Everybody arrived, including the two with no names at all.
        val arrived = into.observeAllPeople().first()
        assertEquals(8, arrived.size)
        assertEquals(2, arrived.count { it.isUnnamed })

        // Details survived exactly.
        val importedMe = arrived.single { it.name == "Ankit Kumar" }
        assertEquals("1990-05-01", importedMe.birthDate)
        assertEquals(Gender.MALE, importedMe.gender)
        assertEquals("eldest", importedMe.notes)

        val importedGrandfather = arrived.single { it.name == "Shyam Lal" }
        assertEquals("1978", importedGrandfather.deathDate)
        assertTrue(importedGrandfather.deceased)

        // And so did the shape of the family.
        val importedFather = arrived.single { it.name == "Raj Kumar" }
        assertEquals(
            setOf("Sushila Devi", "Meena"),
            into.observeSpouses(importedFather.id).first().map { it.name }.toSet(),
        )
        assertEquals(
            setOf("Ankit Kumar", "Rohit"),
            into.observeChildren(importedFather.id).first().map { it.name }.toSet(),
        )
        // Half-siblings still fall out of the shared parent rather than needing an edge.
        assertEquals(
            listOf("Rohit"),
            into.observeSiblings(importedMe.id).first().map { it.name },
        )
        // The unnamed child kept its place.
        assertEquals(1, into.observeChildren(importedMe.id).first().size)
    }

    @Test
    fun photosSurviveTheRoundTrip() = runTest {
        val bytes = ByteArrayOutputStream().use {
            android.graphics.Bitmap.createBitmap(120, 120, android.graphics.Bitmap.Config.ARGB_8888)
                .compress(android.graphics.Bitmap.CompressFormat.JPEG, 90, it)
            it.toByteArray()
        }
        val photoId = photos.saveBytes(bytes)!!
        from.addPerson(Person(name = "Ankit Kumar", photoId = photoId))

        val identity = TreeIdentity(context)
        val archive = ByteArrayOutputStream()
            .also { TreeExporter(from, photos, identity).exportTo(it) }
            .toByteArray()

        val importer = TreeImporter(
            database = destination,
            repository = into,
            photos = photos,
            identity = TreeIdentity(context),
            exporter = TreeExporter(into, photos, TreeIdentity(context)),
            workingDirectory = working,
        )
        val plan = importer.prepare(archive.inputStream())
        val result = importer.apply(plan, plan.defaultDecisions)

        assertEquals(1, result.photosAdded)
        val imported = into.observeAllPeople().first().single()
        assertNotNull(imported.photoId)
        assertTrue("the photo file should exist", photos.exists(imported.photoId))
    }

    @Test
    fun anImportStillWorksWhenTheArchiveHasNoPhotos() = runTest {
        // A tree exported from a device where the photo files had been cleared.
        from.addPerson(Person(name = "Ankit Kumar", photoId = "long-gone.jpg"))

        val archive = ByteArrayOutputStream()
            .also { TreeExporter(from, photos, TreeIdentity(context)).exportTo(it) }
            .toByteArray()

        val importer = TreeImporter(
            database = destination,
            repository = into,
            photos = photos,
            identity = TreeIdentity(context),
            exporter = TreeExporter(into, photos, TreeIdentity(context)),
            workingDirectory = working,
        )
        val plan = importer.prepare(archive.inputStream())
        val result = importer.apply(plan, plan.defaultDecisions)

        assertEquals(1, result.peopleAdded)
        assertEquals(0, result.photosAdded)
        // The person arrives; only their picture is missing.
        assertEquals("Ankit Kumar", into.observeAllPeople().first().single().name)
    }
}
