package com.vibethroughcode.ftree.transfer

import android.content.Context
import android.graphics.Bitmap
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.vibethroughcode.ftree.data.FTreeDatabase
import com.vibethroughcode.ftree.data.FamilyRepository
import com.vibethroughcode.ftree.data.Gender
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.data.PhotoStore
import com.vibethroughcode.ftree.data.RelativeKind
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
import java.util.zip.ZipInputStream

@RunWith(AndroidJUnit4::class)
class TreeExporterTest {

    private lateinit var db: FTreeDatabase
    private lateinit var repository: FamilyRepository
    private lateinit var photos: PhotoStore
    private lateinit var exporter: TreeExporter
    private lateinit var photoDirectory: File

    @Before
    fun setUp() {
        val context: Context = ApplicationProvider.getApplicationContext()
        db = Room.inMemoryDatabaseBuilder(context, FTreeDatabase::class.java)
            .addCallback(FTreeDatabase.enforceForeignKeys)
            .build()
        photos = PhotoStore(context)
        photoDirectory = File(context.filesDir, PhotoStore.DIRECTORY)
        photoDirectory.deleteRecursively()
        repository = FamilyRepository(db, photos)
        exporter = TreeExporter(repository, photos, TreeIdentity(context))
    }

    @After
    fun tearDown() {
        db.close()
        photoDirectory.deleteRecursively()
    }

    private fun jpeg(): ByteArray {
        val bitmap = Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888)
        return ByteArrayOutputStream().use {
            bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it)
            it.toByteArray()
        }
    }

    /** Reads an archive back into its entries. */
    private fun entriesOf(bytes: ByteArray): Map<String, ByteArray> = buildMap {
        ZipInputStream(bytes.inputStream()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                put(entry.name, zip.readBytes())
                zip.closeEntry()
            }
        }
    }

    private suspend fun export(): Pair<ExportSummary, Map<String, ByteArray>> {
        val out = ByteArrayOutputStream()
        val summary = exporter.exportTo(out)
        return summary to entriesOf(out.toByteArray())
    }

    private fun document(entries: Map<String, ByteArray>): TreeDocument =
        ExportJson.decodeFromString(String(entries.getValue(TreeDocument.ENTRY_JSON)))

    @Test
    fun anEmptyTreeStillProducesAValidArchive() = runTest {
        val (summary, entries) = export()

        assertEquals(0, summary.people)
        val parsed = document(entries)
        assertEquals(TreeDocument.FORMAT, parsed.format)
        assertEquals(TreeDocument.VERSION, parsed.version)
        assertTrue(parsed.people.isEmpty())
    }

    @Test
    fun everyPersonAndConnectionIsCarried() = runTest {
        val me = Person(name = "Ankit Kumar", gender = Gender.MALE, birthDate = "1990-05-01")
        val father = Person(name = "Raj Kumar", birthDate = "1938", deathDate = "2010", deceased = true)
        val unknown = Person()
        listOf(me, father, unknown).forEach { repository.addPerson(it) }
        repository.addRelative(me.id, father.id, RelativeKind.PARENT)
        repository.addRelative(me.id, unknown.id, RelativeKind.PARENT)

        val (summary, entries) = export()
        val parsed = document(entries)

        assertEquals(3, summary.people)
        assertEquals(2, summary.relationships)
        assertEquals(3, parsed.people.size)
        assertEquals(2, parsed.relationships.size)

        val exportedFather = parsed.people.single { it.id == father.id }
        assertEquals("Raj Kumar", exportedFather.name)
        assertEquals("1938", exportedFather.birthDate)
        assertEquals("2010", exportedFather.deathDate)
        assertTrue(exportedFather.deceased)

        // The person nobody could name is exported as a real record, not dropped.
        val exportedUnknown = parsed.people.single { it.id == unknown.id }
        assertNull(exportedUnknown.name)
    }

    @Test
    fun photosTravelInsideTheArchive() = runTest {
        val photoId = photos.saveBytes(jpeg())!!
        repository.addPerson(Person(name = "Ankit", photoId = photoId))

        val (summary, entries) = export()

        assertEquals(1, summary.photos)
        assertEquals(0, summary.missingPhotos)
        assertTrue(entries.containsKey(TreeDocument.ENTRY_PHOTOS + photoId))
        assertEquals(
            TreeDocument.ENTRY_PHOTOS + photoId,
            document(entries).people.single().photo,
        )
    }

    @Test
    fun aPhotoWhoseFileHasGoneIsOmittedRatherThanPromised() = runTest {
        repository.addPerson(Person(name = "Ankit", photoId = "vanished.jpg"))

        val (summary, entries) = export()

        assertEquals(1, summary.missingPhotos)
        assertEquals(0, summary.photos)
        // An import must never meet a photo entry that is not in the archive.
        assertNull(document(entries).people.single().photo)
    }

    @Test
    fun theExportClaimsThisInstallationAsItsOrigin() = runTest {
        repository.addPerson(Person(name = "Ankit"))

        val parsed = document(export().second)

        assertNotNull(parsed.sourceTreeId)
        assertTrue(parsed.sourceTreeId.isNotBlank())
        assertTrue(parsed.exportedAt.isNotBlank())
    }

    @Test
    fun theTreeIdIsStableAcrossExports() = runTest {
        repository.addPerson(Person(name = "Ankit"))

        val first = document(export().second).sourceTreeId
        val second = document(export().second).sourceTreeId

        // Without this, re-importing the app's own export could not be recognised as its own.
        assertEquals(first, second)
    }

    @Test
    fun symmetricRelationshipsAreExportedOnce() = runTest {
        val a = Person(name = "Ankit")
        val b = Person(name = "Priya")
        listOf(a, b).forEach { repository.addPerson(it) }
        repository.addRelative(a.id, b.id, RelativeKind.SPOUSE)

        val parsed = document(export().second)

        assertEquals(1, parsed.relationships.size)
        assertEquals("SPOUSE", parsed.relationships.single().type)
    }
}
