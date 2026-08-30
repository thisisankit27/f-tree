package com.vibethroughcode.ftree.data

import androidx.room.Entity
import androidx.room.ForeignKey
import androidx.room.Index
import androidx.room.PrimaryKey
import java.util.UUID

/**
 * An edge in the family graph.
 *
 * The graph is modelled as people plus edges rather than as a tree, because real families are not
 * trees: multiple spouses, children across different spouses, half-siblings and unknown ancestors
 * all have to be expressible without special cases.
 */
@Entity(
    tableName = "relationships",
    foreignKeys = [
        ForeignKey(
            entity = Person::class,
            parentColumns = ["id"],
            childColumns = ["fromPersonId"],
            onDelete = ForeignKey.CASCADE,
        ),
        ForeignKey(
            entity = Person::class,
            parentColumns = ["id"],
            childColumns = ["toPersonId"],
            onDelete = ForeignKey.CASCADE,
        ),
    ],
    indices = [
        // Makes "this relationship already exists" a database guarantee rather than a race the
        // application layer has to win. Symmetric edges are stored canonically so both orderings
        // collide here.
        Index(value = ["fromPersonId", "toPersonId", "type"], unique = true),
        Index(value = ["fromPersonId", "type"]),
        Index(value = ["toPersonId", "type"]),
    ],
)
data class Relationship(
    @PrimaryKey val id: String = UUID.randomUUID().toString(),

    /** For [RelationshipType.PARENT] this is the parent. */
    val fromPersonId: String,

    /** For [RelationshipType.PARENT] this is the child. */
    val toPersonId: String,

    val type: RelationshipType,

    /**
     * Refinement of [type] — a [ParentKind], [SpouseKind] or [SiblingKind] name. Free text rather
     * than a typed column so a new refinement never needs a schema migration.
     */
    val subtype: String? = null,

    val createdAt: Long = System.currentTimeMillis(),
) {
    fun other(personId: String): String? = when (personId) {
        fromPersonId -> toPersonId
        toPersonId -> fromPersonId
        else -> null
    }

    companion object {
        /**
         * Builds an edge, putting symmetric ones in canonical order so that A–B and B–A are the
         * same row. Without this, "add spouse" from either side would create two rows describing
         * one marriage.
         */
        fun of(
            fromPersonId: String,
            toPersonId: String,
            type: RelationshipType,
            subtype: String? = null,
            id: String = UUID.randomUUID().toString(),
            createdAt: Long = System.currentTimeMillis(),
        ): Relationship {
            val (a, b) = if (type.isSymmetric && fromPersonId > toPersonId) {
                toPersonId to fromPersonId
            } else {
                fromPersonId to toPersonId
            }
            return Relationship(id, a, b, type, subtype, createdAt)
        }
    }
}
