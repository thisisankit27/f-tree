package com.vibethroughcode.ftree.data

import androidx.room.withTransaction
import com.vibethroughcode.ftree.graph.FamilyGraph
import com.vibethroughcode.ftree.graph.RelationshipCheck
import com.vibethroughcode.ftree.graph.RelationshipRejection
import com.vibethroughcode.ftree.graph.RelationshipRules
import kotlinx.coroutines.flow.Flow

/** What to do with a person's relationships when the person is removed. */
enum class DeletionMode {
    /**
     * Strip the person back to an unknown placeholder but keep the node and every edge, so the
     * shape of the family survives losing one name.
     */
    KEEP_AS_UNKNOWN,

    /** Remove the person and, by cascade, every edge that touched them. */
    DELETE_COMPLETELY,
}

/**
 * The single door to family data.
 *
 * Reads are `Flow`-based and deliberately narrow — one person, one person's relatives — rather
 * than "load the graph", because the graph is expected to reach thousands of people.
 */
class FamilyRepository(
    private val db: FTreeDatabase,
    private val people: PersonDao = db.personDao(),
    private val relationships: RelationshipDao = db.relationshipDao(),
    private val origins: PersonOriginDao = db.personOriginDao(),
) {

    fun observeAllPeople(): Flow<List<Person>> = people.observeAll()
    fun observePerson(id: String): Flow<Person?> = people.observeById(id)
    fun observePersonCount(): Flow<Int> = people.observeCount()
    fun searchPeople(query: String): Flow<List<Person>> = people.search(query)

    fun observeParents(id: String): Flow<List<Person>> = relationships.observeParents(id)
    fun observeChildren(id: String): Flow<List<Person>> = relationships.observeChildren(id)
    fun observeSpouses(id: String): Flow<List<Person>> = relationships.observeSpouses(id)
    fun observeSiblings(id: String): Flow<List<Person>> = relationships.observeSiblings(id)
    fun observeEdgesOf(id: String): Flow<List<Relationship>> = relationships.observeEdgesOf(id)

    suspend fun person(id: String): Person? = people.findById(id)
    suspend fun relationshipCount(id: String): Int = relationships.edgeCount(id)

    suspend fun edgesBetween(a: String, b: String): List<Relationship> = relationships.edgesBetween(a, b)

    suspend fun ancestorIdsOf(personId: String): Set<String> =
        FamilyGraph.ancestorsOf(personId) { relationships.parentIdsOf(it) }

    suspend fun descendantIdsOf(personId: String): Set<String> =
        FamilyGraph.descendantsOf(personId) { relationships.childIdsOf(it) }

    suspend fun addPerson(person: Person): Person {
        people.insert(person)
        return person
    }

    suspend fun updatePerson(person: Person) {
        people.update(person.copy(updatedAt = System.currentTimeMillis()))
    }

    suspend fun deletePerson(id: String, mode: DeletionMode) = db.withTransaction {
        when (mode) {
            DeletionMode.KEEP_AS_UNKNOWN -> people.clearDetails(id)
            DeletionMode.DELETE_COMPLETELY -> people.deleteById(id)
        }
    }

    /**
     * Records an edge if the rules allow it.
     *
     * Validation runs inside the transaction that writes, so two rapid taps cannot both pass the
     * duplicate check. The unique index is the final backstop.
     */
    suspend fun addRelationship(
        fromPersonId: String,
        toPersonId: String,
        type: RelationshipType,
        subtype: String? = null,
    ): Result<Relationship> = db.withTransaction {
        val check = RelationshipRules.check(
            fromPersonId = fromPersonId,
            toPersonId = toPersonId,
            type = type,
            existingEdgeExists = { from, to, edgeType ->
                relationships.countExact(from, to, edgeType) > 0
            },
            parentsOf = { relationships.parentIdsOf(it) },
        )
        when (check) {
            is RelationshipCheck.Rejected -> Result.failure(RelationshipRejectedException(check.reason))
            RelationshipCheck.Allowed -> {
                val edge = Relationship.of(fromPersonId, toPersonId, type, subtype)
                relationships.insert(edge)
                Result.success(edge)
            }
        }
    }

    suspend fun removeRelationship(id: String) = relationships.deleteById(id)

    /**
     * Records a relationship the way the user described it.
     *
     * Adding a sibling is the one case that is not a single edge. If the anchor already has known
     * parents, the new sibling is attached to those same parents — which is what actually makes
     * them siblings, keeps half-siblings and later-added relatives consistent, and avoids inventing
     * a placeholder parent nobody asked for. Only when no parents are known does an explicit
     * sibling edge get written, because that is the one case shared parents cannot express.
     */
    suspend fun addRelative(
        anchorId: String,
        relativeId: String,
        kind: RelativeKind,
    ): Result<Unit> = when (kind) {
        RelativeKind.PARENT -> addRelationship(relativeId, anchorId, RelationshipType.PARENT).map {}
        RelativeKind.CHILD -> addRelationship(anchorId, relativeId, RelationshipType.PARENT).map {}
        RelativeKind.SPOUSE -> addRelationship(anchorId, relativeId, RelationshipType.SPOUSE).map {}
        RelativeKind.SIBLING -> addSibling(anchorId, relativeId)
    }

    private suspend fun addSibling(anchorId: String, siblingId: String): Result<Unit> {
        if (anchorId == siblingId) {
            return Result.failure(RelationshipRejectedException(RelationshipRejection.SELF_REFERENCE))
        }
        val parents = db.withTransaction { relationships.parentIdsOf(anchorId) }
        if (parents.isEmpty()) {
            return addRelationship(anchorId, siblingId, RelationshipType.SIBLING).map {}
        }

        // Attaching to shared parents is what makes them siblings. A parent the sibling already
        // has is not an error, so a duplicate is skipped rather than failing the whole operation.
        var attached = false
        var lastFailure: Throwable? = null
        parents.forEach { parentId ->
            val result = addRelationship(parentId, siblingId, RelationshipType.PARENT)
            result.onSuccess { attached = true }.onFailure { failure ->
                val duplicate = (failure as? RelationshipRejectedException)?.reason ==
                    RelationshipRejection.DUPLICATE
                if (duplicate) attached = true else lastFailure = failure
            }
        }
        return if (attached) Result.success(Unit) else Result.failure(
            lastFailure ?: RelationshipRejectedException(RelationshipRejection.DUPLICATE)
        )
    }

    /**
     * Creates a person and relates them, atomically.
     *
     * Failure anywhere — the insert or the relationship rules — throws out of the transaction so
     * the database rolls the whole thing back. That is stronger than deleting the person again by
     * hand, which would only undo the cases it remembered to, and it means a caller mistake
     * surfaces as a failed Result rather than a half-written tree.
     */
    suspend fun addNewRelative(
        anchorId: String,
        person: Person,
        kind: RelativeKind,
    ): Result<Person> = runCatching {
        db.withTransaction {
            people.insert(person)
            addRelative(anchorId, person.id, kind).getOrThrow()
            person
        }
    }

    suspend fun originsOf(personIds: List<String>): List<PersonOrigin> = origins.originsOf(personIds)
}

class RelationshipRejectedException(val reason: RelationshipRejection) :
    IllegalArgumentException("Relationship rejected: $reason")
