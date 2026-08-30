package com.vibethroughcode.ftree.data

import androidx.room.withTransaction
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

    suspend fun originsOf(personIds: List<String>): List<PersonOrigin> = origins.originsOf(personIds)
}

class RelationshipRejectedException(val reason: RelationshipRejection) :
    IllegalArgumentException("Relationship rejected: $reason")
