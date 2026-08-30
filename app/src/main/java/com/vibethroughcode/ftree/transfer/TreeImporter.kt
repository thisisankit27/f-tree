package com.vibethroughcode.ftree.transfer

import androidx.room.withTransaction
import com.vibethroughcode.ftree.data.FTreeDatabase
import com.vibethroughcode.ftree.data.FamilyRepository
import com.vibethroughcode.ftree.data.Gender
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.data.PersonOrigin
import com.vibethroughcode.ftree.data.PhotoStore
import com.vibethroughcode.ftree.data.Relationship
import com.vibethroughcode.ftree.data.RelationshipType
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.io.File
import java.io.InputStream
import java.util.UUID
import java.util.zip.ZipInputStream

/**
 * Reads a `.ftree` file into the existing tree.
 *
 * The rule the whole design serves: **an import adds, it never replaces.** Nothing already in the
 * tree is deleted, and no existing value is overwritten by an imported one. The worst an import can
 * do is add people who turn out to be duplicates, which the user can then merge — the opposite
 * mistake, silently collapsing two real people into one, is unrecoverable.
 *
 * Work happens in two halves. [prepare] reads and judges without writing anything; [apply] writes,
 * once, in a single transaction, using decisions the user has seen.
 */
class TreeImporter(
    private val database: FTreeDatabase,
    private val repository: FamilyRepository,
    private val photos: PhotoStore,
    private val identity: TreeIdentity,
    private val exporter: TreeExporter,
    private val workingDirectory: File,
    private val json: Json = ExportJson,
) {

    /** Reads the file and works out what importing it would mean. Writes nothing. */
    suspend fun prepare(source: InputStream): ImportPlan = withContext(Dispatchers.IO) {
        val archive = File(workingDirectory, "import-${System.currentTimeMillis()}.ftree").apply {
            parentFile?.mkdirs()
            // Copied aside because the plan is reviewed before the photos are needed, and the
            // stream a content provider hands over will not still be open by then.
            outputStream().use { source.copyTo(it) }
        }

        val document = runCatching { readDocument(archive) }.getOrElse {
            archive.delete()
            throw if (it is ImportFailure) it else ImportFailure(ImportProblem.NOT_AN_ARCHIVE)
        }

        if (document.format != TreeDocument.FORMAT) {
            archive.delete()
            throw ImportFailure(ImportProblem.NOT_A_TREE_FILE)
        }
        if (document.version > TreeDocument.VERSION) {
            archive.delete()
            // Refusing is the safe answer: a newer file may mean things this build would drop.
            throw ImportFailure(ImportProblem.FROM_A_NEWER_VERSION)
        }
        if (document.people.isEmpty()) {
            archive.delete()
            throw ImportFailure(ImportProblem.EMPTY)
        }

        val local = repository.allPeople()
        val localEdges = repository.allRelationships()
        val origins = repository.originsOf(local.map { it.id })

        val originIndex = buildMap {
            origins.forEach { put(it.sourceTreeId to it.sourcePersonId, it.personId) }
            // An export from this very installation identifies its people by their own ids, so a
            // re-import of our own file recognises everybody without any name comparison at all.
            if (document.sourceTreeId == identity.treeId) {
                local.forEach { put(identity.treeId to it.id, it.id) }
            }
        }

        val matches = DuplicateMatcher.match(
            imported = document.people,
            importedGraph = graphOf(document.relationships.map { it.from to it.to }),
            local = local,
            localGraph = graphOf(localEdges.map { it.fromPersonId to it.toPersonId }),
            originIndex = originIndex,
            sourceTreeId = document.sourceTreeId,
        )

        ImportPlan(document, matches, archive)
    }

    /**
     * Applies a reviewed plan.
     *
     * A backup of the current tree is written first. Undoing a merge properly would mean recording
     * every field that was filled and every row that was added; a file the user can re-import is a
     * far simpler promise to keep, and it cannot itself go wrong.
     */
    suspend fun apply(
        plan: ImportPlan,
        decisions: Map<String, Boolean>,
    ): ImportResult = withContext(Dispatchers.IO) {
        val backup = writeBackup()

        val document = plan.document
        val photoBytes = readPhotos(plan.archive)

        // Resolve every imported person to a local id first: new people get a freshly generated
        // one, because an imported id may belong to somebody else entirely in this tree.
        val idMap = mutableMapOf<String, String>()
        val newPeople = mutableListOf<Person>()
        val mergeTargets = mutableMapOf<String, String>()

        document.people.forEach { record ->
            val match = plan.matchFor(record.id)
            val localId = match?.localId?.takeIf { decisions[record.id] == true }
            if (localId != null) {
                idMap[record.id] = localId
                mergeTargets[record.id] = localId
            } else {
                val fresh = UUID.randomUUID().toString()
                idMap[record.id] = fresh
                newPeople += record.toPerson(fresh)
            }
        }

        // Photos are files, so they are written before the transaction; a failure afterwards leaves
        // an unreferenced file rather than a person pointing at nothing.
        var photosAdded = 0
        val savedPhotos = mutableMapOf<String, String>()
        document.people.forEach { record ->
            val entry = record.photo ?: return@forEach
            val bytes = photoBytes[entry] ?: return@forEach
            val name = entry.removePrefix(TreeDocument.ENTRY_PHOTOS)
            val saved = photos.saveBytes(bytes, preferredId = uniquePhotoName(name))
            if (saved != null) {
                savedPhotos[record.id] = saved
                photosAdded++
            }
        }

        val conflicts = mutableListOf<FieldConflict>()
        var relationshipsAdded = 0
        var alreadyPresent = 0

        database.withTransaction {
            newPeople.forEach { person ->
                val record = document.people.first { idMap[it.id] == person.id }
                database.personDao().insert(person.copy(photoId = savedPhotos[record.id]))
            }

            // Merging fills gaps only. A local value that disagrees is kept and reported; the
            // person in front of the phone is the authority on their own family.
            mergeTargets.forEach { (importedId, localId) ->
                val record = document.people.first { it.id == importedId }
                val existing = database.personDao().findById(localId) ?: return@forEach
                val (filled, found) = existing.filledFrom(record, savedPhotos[importedId])
                conflicts += found
                if (filled != existing) database.personDao().update(filled)
            }

            // Provenance for everybody, so importing this file again recognises them outright.
            val originRows = document.people.flatMap { record ->
                val localId = idMap.getValue(record.id)
                buildList {
                    add(PersonOrigin(localId, document.sourceTreeId, record.id))
                    record.origins.forEach { add(PersonOrigin(localId, it.treeId, it.personId)) }
                }
            }
            database.personOriginDao().insertAll(originRows)

            val edges = document.relationships.mapNotNull { record ->
                val from = idMap[record.from] ?: return@mapNotNull null
                val to = idMap[record.to] ?: return@mapNotNull null
                // Two imported people merged into one local person would produce a self-edge.
                if (from == to) return@mapNotNull null
                Relationship.of(
                    fromPersonId = from,
                    toPersonId = to,
                    type = RelationshipType.fromName(record.type),
                    subtype = record.subtype,
                )
            }
            val inserted = database.relationshipDao().insertIgnoringDuplicates(edges)
            relationshipsAdded = inserted.count { it >= 0 }
            alreadyPresent = inserted.size - relationshipsAdded
        }

        plan.archive.delete()

        ImportResult(
            peopleAdded = newPeople.size,
            peopleMerged = mergeTargets.size,
            relationshipsAdded = relationshipsAdded,
            relationshipsAlreadyPresent = alreadyPresent,
            photosAdded = photosAdded,
            conflicts = conflicts,
            backup = backup,
        )
    }

    fun discard(plan: ImportPlan) {
        plan.archive.delete()
    }

    // ------------------------------------------------------------------ helpers

    private fun graphOf(edges: List<Pair<String, String>>): MatchGraph {
        val neighbours = mutableMapOf<String, MutableSet<String>>()
        edges.forEach { (a, b) ->
            neighbours.getOrPut(a) { mutableSetOf() } += b
            neighbours.getOrPut(b) { mutableSetOf() } += a
        }
        return MatchGraph(neighbours)
    }

    private fun readDocument(archive: File): TreeDocument {
        ZipInputStream(archive.inputStream().buffered()).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                if (entry.name == TreeDocument.ENTRY_JSON) {
                    return json.decodeFromString(String(zip.readBytes()))
                }
                zip.closeEntry()
            }
        }
        throw ImportFailure(ImportProblem.NOT_A_TREE_FILE)
    }

    private fun readPhotos(archive: File): Map<String, ByteArray> = buildMap {
        runCatching {
            ZipInputStream(archive.inputStream().buffered()).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    if (entry.name.startsWith(TreeDocument.ENTRY_PHOTOS) && !entry.isDirectory) {
                        put(entry.name, zip.readBytes())
                    }
                    zip.closeEntry()
                }
            }
        }
    }

    /** Keeps an imported photo from overwriting one this device already has under the same name. */
    private fun uniquePhotoName(name: String): String =
        if (photos.exists(name)) "${UUID.randomUUID()}.jpg" else name

    private suspend fun writeBackup(): File? = runCatching {
        val directory = File(workingDirectory, BACKUPS).apply { mkdirs() }
        val file = File(directory, "before-import-${System.currentTimeMillis()}.ftree")
        file.outputStream().use { exporter.exportTo(it) }

        // Keep a few, not a growing pile; these exist to undo a mistake noticed soon after.
        directory.listFiles().orEmpty()
            .sortedByDescending { it.lastModified() }
            .drop(KEEP_BACKUPS)
            .forEach { it.delete() }

        file
    }.getOrNull()

    private companion object {
        const val BACKUPS = "backups"
        const val KEEP_BACKUPS = 3
    }
}

private fun PersonRecord.toPerson(localId: String) = Person(
    id = localId,
    name = name?.trim()?.takeIf { it.isNotEmpty() },
    gender = Gender.entries.firstOrNull { it.name == gender } ?: Gender.UNSPECIFIED,
    birthDate = birthDate,
    deathDate = deathDate,
    deceased = deceased,
    notes = notes,
)

/**
 * Fills this person's gaps from an imported record.
 *
 * Never overwrites: an empty field takes the imported value, a field that already says something
 * keeps saying it, and a disagreement is reported rather than resolved.
 */
private fun Person.filledFrom(
    record: PersonRecord,
    importedPhotoId: String?,
): Pair<Person, List<FieldConflict>> {
    val conflicts = mutableListOf<FieldConflict>()

    fun pick(field: String, mine: String?, theirs: String?): String? = when {
        mine.isNullOrBlank() -> theirs
        theirs.isNullOrBlank() || mine == theirs -> mine
        else -> mine.also {
            conflicts += FieldConflict(name ?: record.name, field, mine, theirs)
        }
    }

    val merged = copy(
        name = pick("name", name, record.name),
        gender = if (gender == Gender.UNSPECIFIED) {
            Gender.entries.firstOrNull { it.name == record.gender } ?: Gender.UNSPECIFIED
        } else {
            gender
        },
        birthDate = pick("born", birthDate, record.birthDate),
        deathDate = pick("died", deathDate, record.deathDate),
        deceased = deceased || record.deceased,
        photoId = photoId ?: importedPhotoId,
        notes = pick("notes", notes, record.notes),
        updatedAt = System.currentTimeMillis(),
    )
    return merged to conflicts
}
