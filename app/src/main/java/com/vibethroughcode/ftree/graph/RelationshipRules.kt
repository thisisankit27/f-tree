package com.vibethroughcode.ftree.graph

import com.vibethroughcode.ftree.data.RelationshipType

/** Why a proposed relationship was refused. */
enum class RelationshipRejection {
    /** A person cannot be their own parent, spouse or sibling. */
    SELF_REFERENCE,

    /** The same edge, in either direction for symmetric types, already exists. */
    DUPLICATE,

    /** The edge would make someone their own ancestor. */
    ANCESTOR_CYCLE,

    /** The two people are already parent and child, so they cannot also be siblings or spouses. */
    CONTRADICTS_EXISTING,
}

sealed interface RelationshipCheck {
    data object Allowed : RelationshipCheck
    data class Rejected(val reason: RelationshipRejection) : RelationshipCheck
}

/**
 * Whether a proposed edge is a sane thing to record.
 *
 * Kept pure — it is handed the small amount of graph context it needs — so that the rules can be
 * exhaustively unit tested without a database, and so the same rules apply whether an edge arrives
 * from the UI or from an import.
 */
object RelationshipRules {

    suspend fun check(
        fromPersonId: String,
        toPersonId: String,
        type: RelationshipType,
        existingEdgeExists: suspend (from: String, to: String, type: RelationshipType) -> Boolean,
        parentsOf: suspend (String) -> List<String>,
    ): RelationshipCheck {
        if (fromPersonId == toPersonId) {
            return RelationshipCheck.Rejected(RelationshipRejection.SELF_REFERENCE)
        }

        val duplicate = existingEdgeExists(fromPersonId, toPersonId, type) ||
            (type.isSymmetric && existingEdgeExists(toPersonId, fromPersonId, type))
        if (duplicate) {
            return RelationshipCheck.Rejected(RelationshipRejection.DUPLICATE)
        }

        // A parent cannot also be a spouse or sibling of their own child.
        if (type != RelationshipType.PARENT) {
            val alreadyParentChild =
                existingEdgeExists(fromPersonId, toPersonId, RelationshipType.PARENT) ||
                    existingEdgeExists(toPersonId, fromPersonId, RelationshipType.PARENT)
            if (alreadyParentChild) {
                return RelationshipCheck.Rejected(RelationshipRejection.CONTRADICTS_EXISTING)
            }
        }

        if (type == RelationshipType.PARENT &&
            FamilyGraph.wouldCreateAncestorCycle(fromPersonId, toPersonId, parentsOf)
        ) {
            return RelationshipCheck.Rejected(RelationshipRejection.ANCESTOR_CYCLE)
        }

        return RelationshipCheck.Allowed
    }
}
