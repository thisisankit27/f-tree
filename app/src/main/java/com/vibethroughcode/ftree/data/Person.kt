package com.vibethroughcode.ftree.data

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import java.time.LocalDate
import java.util.UUID

/**
 * A node in the family graph.
 *
 * Every descriptive field is optional. That is not laziness in the schema — it is the feature:
 * "my grandfather had a brother, but I never knew his name" has to be representable as a real
 * entity so that a relationship can hang off it and a name can be filled in years later without
 * rebuilding anything.
 */
@Entity(
    tableName = "people",
    indices = [Index(value = ["name"])],
)
data class Person(
    @PrimaryKey val id: String = UUID.randomUUID().toString(),

    /** Null or blank means an unknown/placeholder person. */
    val name: String? = null,

    val gender: Gender = Gender.UNSPECIFIED,

    /** Partial ISO-8601 date; see [PartialDate]. */
    val birthDate: String? = null,
    val deathDate: String? = null,

    /** Someone can be known to have died without the date being known, so this is not derived. */
    val deceased: Boolean = false,

    /**
     * File name within the app's internal `photos/` directory — never an absolute path, so the
     * reference survives reinstall, restore and a change of storage location.
     */
    val photoId: String? = null,

    val notes: String? = null,

    @ColumnInfo(defaultValue = "0") val createdAt: Long = System.currentTimeMillis(),
    @ColumnInfo(defaultValue = "0") val updatedAt: Long = System.currentTimeMillis(),
) {
    /** True when this person carries no identifying information yet. */
    val isUnnamed: Boolean get() = name.isNullOrBlank()

    val birth: PartialDate? get() = PartialDate.parse(birthDate)
    val death: PartialDate? get() = PartialDate.parse(deathDate)

    /**
     * Age in whole years, or null when it cannot be stated. Derived rather than stored so there is
     * exactly one source of truth and it can never drift out of date.
     */
    fun age(today: LocalDate = LocalDate.now()): Int? {
        val born = birth ?: return null
        val end = death ?: if (deceased) return null else PartialDate(today.year, today.monthValue, today.dayOfMonth)
        return yearsBetween(born, end)
    }
}
