package com.vibethroughcode.ftree.data

/**
 * Edge kinds in the family graph.
 *
 * Stored as the enum *name* in a TEXT column rather than as an ordinal, so adding a new kind is
 * additive and never renumbers existing rows. [UNKNOWN] is the fallback for a value written by a
 * newer version of the app (or a newer export) than the one doing the reading — a row is never
 * dropped just because its type is unrecognised.
 */
enum class RelationshipType {
    /** Directed: `from` is the parent of `to`. */
    PARENT,

    /** Symmetric. */
    SPOUSE,

    /**
     * Symmetric, and deliberately rare: siblings are normally *derived* from shared parents.
     * An explicit edge exists only when the shared parents are unknown.
     */
    SIBLING,

    UNKNOWN;

    /** Symmetric edges are stored canonically so that duplicates collide on the unique index. */
    val isSymmetric: Boolean get() = this == SPOUSE || this == SIBLING

    companion object {
        fun fromName(value: String?): RelationshipType =
            entries.firstOrNull { it.name == value } ?: UNKNOWN
    }
}

/** How a parent relates to a child. Stored as free text in `subtype`; absent means biological. */
enum class ParentKind { BIOLOGICAL, ADOPTIVE, STEP, FOSTER }

/** The state of a spouse relationship. Absent means simply "married or partnered". */
enum class SpouseKind { MARRIED, PARTNER, DIVORCED, WIDOWED }

/** Only meaningful on explicit sibling edges. */
enum class SiblingKind { FULL, HALF }
