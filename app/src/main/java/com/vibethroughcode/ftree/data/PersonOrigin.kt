package com.vibethroughcode.ftree.data

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index

/**
 * Where an imported person came from.
 *
 * This is what turns "is this the same Ankit Kumar?" from a guess into a fact. An export stamps
 * every person with the exporting install's tree id, so re-importing the same file — or a file
 * derived from it — matches exactly instead of relying on name heuristics, which is what makes
 * repeated imports idempotent.
 *
 * A person accumulates origins as they are merged from several sources, hence one row per source
 * rather than a column on [Person].
 */
@Entity(
    tableName = "person_origins",
    primaryKeys = ["personId", "sourceTreeId", "sourcePersonId"],
    foreignKeys = [
        ForeignKey(
            entity = Person::class,
            parentColumns = ["id"],
            childColumns = ["personId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [Index(value = ["sourceTreeId", "sourcePersonId"])],
)
data class PersonOrigin(
    val personId: String,
    val sourceTreeId: String,
    val sourcePersonId: String,
)
