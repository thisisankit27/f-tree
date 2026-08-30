package com.vibethroughcode.ftree.transfer

import com.vibethroughcode.ftree.data.FamilyRepository
import com.vibethroughcode.ftree.data.PhotoStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.io.OutputStream
import java.time.Instant
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

data class ExportSummary(
    val people: Int,
    val relationships: Int,
    val photos: Int,
    /** Photos referenced by a person whose file is gone; the export simply omits them. */
    val missingPhotos: Int,
)

/**
 * Writes the whole tree to a `.ftree` archive.
 *
 * Streams straight into the destination rather than building the file in memory, so exporting a
 * large family with photographs costs no more memory than exporting a small one.
 */
class TreeExporter(
    private val repository: FamilyRepository,
    private val photos: PhotoStore,
    private val identity: TreeIdentity,
    private val json: Json = ExportJson,
) {

    suspend fun exportTo(destination: OutputStream): ExportSummary = withContext(Dispatchers.IO) {
        val people = repository.allPeople()
        val relationships = repository.allRelationships()
        val origins = repository.originsOf(people.map { it.id }).groupBy { it.personId }

        val referenced = people.mapNotNull { it.photoId }
        val missing = photos.missing(referenced).toSet()
        val exportable = referenced.filterNot { it in missing }

        val document = TreeDocument(
            exportedAt = Instant.now().toString(),
            sourceTreeId = identity.treeId,
            people = people.map { person ->
                PersonRecord(
                    id = person.id,
                    name = person.name,
                    gender = person.gender.name,
                    birthDate = person.birthDate,
                    deathDate = person.deathDate,
                    deceased = person.deceased,
                    // A photo whose file has gone is dropped rather than promised, so an import
                    // never has to cope with an entry that is not in the archive.
                    photo = person.photoId?.takeIf { it !in missing }
                        ?.let { TreeDocument.ENTRY_PHOTOS + it },
                    notes = person.notes,
                    origins = origins[person.id].orEmpty()
                        .map { OriginRecord(it.sourceTreeId, it.sourcePersonId) },
                )
            },
            relationships = relationships.map {
                RelationshipRecord(
                    id = it.id,
                    from = it.fromPersonId,
                    to = it.toPersonId,
                    type = it.type.name,
                    subtype = it.subtype,
                )
            },
        )

        ZipOutputStream(destination.buffered()).use { zip ->
            zip.putNextEntry(ZipEntry(TreeDocument.ENTRY_JSON))
            zip.write(json.encodeToString(document).toByteArray())
            zip.closeEntry()

            exportable.forEach { photoId ->
                val file = photos.file(photoId)
                if (!file.exists()) return@forEach
                zip.putNextEntry(ZipEntry(TreeDocument.ENTRY_PHOTOS + photoId))
                file.inputStream().use { it.copyTo(zip) }
                zip.closeEntry()
            }
        }

        ExportSummary(
            people = people.size,
            relationships = relationships.size,
            photos = exportable.size,
            missingPhotos = missing.size,
        )
    }
}

/**
 * Lenient on the way in, tidy on the way out.
 *
 * [ignoreUnknownKeys] is what lets a file written by a future release still open here rather than
 * failing outright, and defaults are not written so the archive stays small and readable.
 */
val ExportJson: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = false
    prettyPrint = false
}
