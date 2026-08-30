package com.vibethroughcode.ftree.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface PersonOriginDao {

    @Query("SELECT * FROM person_origins WHERE personId IN (:personIds)")
    suspend fun originsOf(personIds: List<String>): List<PersonOrigin>

    @Query("SELECT * FROM person_origins")
    suspend fun all(): List<PersonOrigin>

    @Query(
        "SELECT personId FROM person_origins WHERE sourceTreeId = :treeId AND sourcePersonId = :personId"
    )
    suspend fun localIdFor(treeId: String, personId: String): String?

    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAll(origins: List<PersonOrigin>)
}
