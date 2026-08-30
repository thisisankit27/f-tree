package com.vibethroughcode.ftree.data

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface RelationshipDao {

    @Query("SELECT * FROM relationships WHERE id = :id")
    suspend fun findById(id: String): Relationship?

    @Query("SELECT * FROM relationships")
    suspend fun allRelationships(): List<Relationship>

    /** Every edge touching this person, in either direction. */
    @Query("SELECT * FROM relationships WHERE fromPersonId = :personId OR toPersonId = :personId")
    suspend fun edgesOf(personId: String): List<Relationship>

    @Query("SELECT * FROM relationships WHERE fromPersonId = :personId OR toPersonId = :personId")
    fun observeEdgesOf(personId: String): Flow<List<Relationship>>

    @Query("SELECT COUNT(*) FROM relationships WHERE fromPersonId = :personId OR toPersonId = :personId")
    suspend fun edgeCount(personId: String): Int

    @Query(
        """
        SELECT p.* FROM people p
        JOIN relationships r ON r.fromPersonId = p.id
        WHERE r.toPersonId = :personId AND r.type = 'PARENT'
        """
    )
    fun observeParents(personId: String): Flow<List<Person>>

    @Query(
        """
        SELECT p.* FROM people p
        JOIN relationships r ON r.toPersonId = p.id
        WHERE r.fromPersonId = :personId AND r.type = 'PARENT'
        ORDER BY p.birthDate
        """
    )
    fun observeChildren(personId: String): Flow<List<Person>>

    @Query(
        """
        SELECT p.* FROM people p
        JOIN relationships r
          ON (r.fromPersonId = p.id AND r.toPersonId = :personId)
          OR (r.toPersonId = p.id AND r.fromPersonId = :personId)
        WHERE r.type = 'SPOUSE'
        """
    )
    fun observeSpouses(personId: String): Flow<List<Person>>

    /**
     * Siblings are *derived* from shared parents rather than stored, so they stay correct when a
     * parent is added later and the graph never accumulates O(n^2) redundant edges. Explicit
     * SIBLING edges are unioned in to cover the case where the shared parents are unknown.
     */
    @Query(
        """
        SELECT DISTINCT p.* FROM people p
        JOIN relationships mine ON mine.toPersonId = :personId AND mine.type = 'PARENT'
        JOIN relationships theirs
          ON theirs.fromPersonId = mine.fromPersonId
         AND theirs.type = 'PARENT'
         AND theirs.toPersonId = p.id
        WHERE p.id != :personId

        UNION

        SELECT p.* FROM people p
        JOIN relationships r
          ON (r.fromPersonId = p.id AND r.toPersonId = :personId)
          OR (r.toPersonId = p.id AND r.fromPersonId = :personId)
        WHERE r.type = 'SIBLING' AND p.id != :personId
        """
    )
    fun observeSiblings(personId: String): Flow<List<Person>>

    @Query("SELECT toPersonId FROM relationships WHERE fromPersonId = :personId AND type = 'PARENT'")
    suspend fun childIdsOf(personId: String): List<String>

    @Query("SELECT fromPersonId FROM relationships WHERE toPersonId = :personId AND type = 'PARENT'")
    suspend fun parentIdsOf(personId: String): List<String>

    @Query(
        """
        SELECT COUNT(*) FROM relationships
        WHERE type = :type AND fromPersonId = :from AND toPersonId = :to
        """
    )
    suspend fun countExact(from: String, to: String, type: RelationshipType): Int

    /**
     * ABORT rather than REPLACE: a colliding insert means the edge already exists, and the caller
     * needs to know that instead of silently replacing a row (and its id) that other data may
     * reference.
     */
    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(relationship: Relationship)

    /** Used by import, where an already-present edge is expected and simply nothing to do. */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertIgnoringDuplicates(relationships: List<Relationship>): List<Long>

    @Delete
    suspend fun delete(relationship: Relationship)

    @Query("DELETE FROM relationships WHERE id = :id")
    suspend fun deleteById(id: String)
}
