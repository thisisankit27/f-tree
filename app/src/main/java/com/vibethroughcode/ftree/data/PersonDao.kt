package com.vibethroughcode.ftree.data

import androidx.room.Dao
import androidx.room.Delete
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update
import androidx.room.Upsert
import kotlinx.coroutines.flow.Flow

@Dao
interface PersonDao {

    @Query("SELECT * FROM people WHERE id = :id")
    suspend fun findById(id: String): Person?

    @Query("SELECT * FROM people WHERE id = :id")
    fun observeById(id: String): Flow<Person?>

    @Query("SELECT * FROM people WHERE id IN (:ids)")
    suspend fun findByIds(ids: List<String>): List<Person>

    /** Named people first, alphabetically; unknown people collected at the end. */
    @Query(
        """
        SELECT * FROM people
        ORDER BY CASE WHEN name IS NULL OR TRIM(name) = '' THEN 1 ELSE 0 END,
                 name COLLATE NOCASE
        """
    )
    fun observeAll(): Flow<List<Person>>

    @Query(
        """
        SELECT * FROM people
        WHERE name LIKE '%' || :query || '%' COLLATE NOCASE
        ORDER BY name COLLATE NOCASE
        LIMIT :limit
        """
    )
    fun search(query: String, limit: Int = 100): Flow<List<Person>>

    @Query("SELECT COUNT(*) FROM people")
    fun observeCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM people")
    suspend fun count(): Int

    @Query("SELECT * FROM people")
    suspend fun allPeople(): List<Person>

    /**
     * The best person to open the chart on when nothing has been chosen yet.
     *
     * The most connected person is almost always the one who built the tree, or the ancestor they
     * built it around — either way a far more useful first view than whoever happens to sort first,
     * which tends to be a leaf with nothing above or below them.
     */
    @Query(
        """
        SELECT p.id FROM people p
        LEFT JOIN relationships r
          ON r.fromPersonId = p.id OR r.toPersonId = p.id
        GROUP BY p.id
        ORDER BY COUNT(r.id) DESC, p.createdAt ASC
        LIMIT 1
        """
    )
    suspend fun mostConnectedPersonId(): String?

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insert(person: Person)

    @Insert(onConflict = OnConflictStrategy.ABORT)
    suspend fun insertAll(people: List<Person>)

    @Update
    suspend fun update(person: Person)

    @Upsert
    suspend fun upsert(person: Person)

    @Delete
    suspend fun delete(person: Person)

    @Query("DELETE FROM people WHERE id = :id")
    suspend fun deleteById(id: String)

    /**
     * Strips a person back to an unknown placeholder while leaving every edge intact, so deleting
     * someone you know little about does not tear a hole in the shape of the family.
     */
    @Query(
        """
        UPDATE people
        SET name = NULL, gender = 'UNSPECIFIED', birthDate = NULL, deathDate = NULL,
            deceased = 0, photoId = NULL, notes = NULL, updatedAt = :now
        WHERE id = :id
        """
    )
    suspend fun clearDetails(id: String, now: Long = System.currentTimeMillis())
}
