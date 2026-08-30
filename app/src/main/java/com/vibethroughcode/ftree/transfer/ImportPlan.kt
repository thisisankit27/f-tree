package com.vibethroughcode.ftree.transfer

import java.io.File

/** Why a file could not be read. Each is something the user can act on. */
enum class ImportProblem {
    NOT_AN_ARCHIVE,
    NOT_A_TREE_FILE,
    FROM_A_NEWER_VERSION,
    EMPTY,
    UNREADABLE,
}

class ImportFailure(val problem: ImportProblem) : Exception("Import failed: $problem")

/**
 * What an import *would* do, worked out before anything is written.
 *
 * Nothing about the tree changes until the user confirms this plan. That separation is the whole
 * safety story: every judgement the app makes is visible and reversible while it is still only a
 * proposal.
 */
data class ImportPlan(
    val document: TreeDocument,
    val matches: List<PersonMatch>,
    /** The archive, copied aside so photos can be read after the plan is reviewed. */
    val archive: File,
) {
    private val byImportedId = matches.associateBy { it.importedId }

    fun matchFor(importedId: String): PersonMatch? = byImportedId[importedId]

    /** Matches the user is asked about; certain ones are not worth interrupting for. */
    val reviewable: List<PersonMatch> get() = matches.filter { it.needsReview }

    val certainMatches: Int get() = matches.count { it.tier == MatchTier.CERTAIN }

    /** Default decisions, which the review screen may override. */
    val defaultDecisions: Map<String, Boolean>
        get() = matches.filter { it.localId != null }.associate { it.importedId to it.mergesByDefault }

    fun peopleAddedUnder(decisions: Map<String, Boolean>): Int =
        matches.count { decisions[it.importedId] != true }

    fun peopleMergedUnder(decisions: Map<String, Boolean>): Int =
        matches.count { decisions[it.importedId] == true }
}

/** A field an imported record disagreed with, where the local value was kept. */
data class FieldConflict(
    val personName: String?,
    val field: String,
    val kept: String,
    val ignored: String,
)

data class ImportResult(
    val peopleAdded: Int = 0,
    val peopleMerged: Int = 0,
    val relationshipsAdded: Int = 0,
    val relationshipsAlreadyPresent: Int = 0,
    val photosAdded: Int = 0,
    val conflicts: List<FieldConflict> = emptyList(),
    val backup: File? = null,
)
