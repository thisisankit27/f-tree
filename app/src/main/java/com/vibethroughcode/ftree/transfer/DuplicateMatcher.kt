package com.vibethroughcode.ftree.transfer

import com.vibethroughcode.ftree.data.PartialDate
import com.vibethroughcode.ftree.data.Person

/** How confident the app is that an imported person is somebody already in the tree. */
enum class MatchTier {
    /** Provably the same person: the file says where they came from and it is someone we hold. */
    CERTAIN,

    /** Same name, dates that agree, and at least one relative in common. */
    STRONG,

    /** Same name and nothing that contradicts it. Could easily be a different person. */
    WEAK,

    /** Nobody here looks like them. */
    NONE,
}

/** Why a match was proposed, so the review screen can show its reasoning rather than a verdict. */
data class MatchEvidence(
    val sameName: Boolean = false,
    val datesAgree: Boolean = false,
    val sharedRelatives: Int = 0,
    val fromSameTree: Boolean = false,
)

data class PersonMatch(
    val importedId: String,
    val localId: String?,
    val tier: MatchTier,
    val evidence: MatchEvidence = MatchEvidence(),
) {
    /**
     * Whether the app merges by default.
     *
     * Only a provable match merges without asking. A strong one is proposed and can be refused; a
     * weak one is proposed as *separate* and must be asked for. The asymmetry is deliberate:
     * wrongly keeping two records apart is a tidy-up, wrongly merging them destroys data.
     */
    val mergesByDefault: Boolean get() = tier == MatchTier.CERTAIN || tier == MatchTier.STRONG

    val needsReview: Boolean get() = tier == MatchTier.STRONG || tier == MatchTier.WEAK
}

/** The graph facts the matcher needs, from either side. */
data class MatchGraph(
    /** Person id to the ids of everyone directly connected to them, whatever the relationship. */
    val neighbours: Map<String, Set<String>>,
)

/**
 * Decides which imported people are already in the tree.
 *
 * Runs in passes. Provable matches are settled first, then those confirmed matches become evidence
 * for their relatives: two people with the same name are far more likely to be the same person when
 * their father already matched. Passes repeat until nothing new is confirmed, bounded so a strange
 * file cannot make this run long.
 *
 * Pure — it is handed both sides as plain data — so every rule here is exhaustively testable.
 */
object DuplicateMatcher {

    private const val MAX_PASSES = 5

    fun match(
        imported: List<PersonRecord>,
        importedGraph: MatchGraph,
        local: List<Person>,
        localGraph: MatchGraph,
        /** `(treeId, personId)` of an already-known origin, to the local person holding it. */
        originIndex: Map<Pair<String, String>, String>,
        sourceTreeId: String,
    ): List<PersonMatch> {
        val localById = local.associateBy { it.id }
        val localByName = local.groupBy { nameKey(it.name) }

        val settled = mutableMapOf<String, PersonMatch>()
        val claimedLocals = mutableSetOf<String>()

        // Pass 0: provable identity. The file records where each person came from, so this is a
        // lookup rather than a judgement.
        imported.forEach { record ->
            val keys = buildList {
                add(sourceTreeId to record.id)
                record.origins.forEach { add(it.treeId to it.personId) }
            }
            val localId = keys.firstNotNullOfOrNull { originIndex[it] }
            if (localId != null && localId in localById && claimedLocals.add(localId)) {
                settled[record.id] = PersonMatch(
                    importedId = record.id,
                    localId = localId,
                    tier = MatchTier.CERTAIN,
                    evidence = MatchEvidence(fromSameTree = true),
                )
            }
        }

        // Later passes: name plus corroboration, with confirmed matches feeding the next round.
        var pass = 0
        var changed = true
        while (changed && pass < MAX_PASSES) {
            pass++
            changed = false

            imported.filterNot { it.id in settled }.forEach { record ->
                val key = nameKey(record.name) ?: return@forEach
                val candidates = localByName[key].orEmpty().filterNot { it.id in claimedLocals }
                if (candidates.isEmpty()) return@forEach

                val scored = candidates
                    .map { candidate ->
                        candidate to score(record, candidate, importedGraph, localGraph, settled)
                    }
                    .filter { it.second != null }
                    .sortedByDescending { it.second!!.sharedRelatives }

                val best = scored.firstOrNull() ?: return@forEach
                val evidence = best.second!!

                // Two local people with the same name and nothing to tell them apart: proposing
                // either would be a coin toss, so neither is proposed.
                val ambiguous = scored.size > 1 &&
                    scored[1].second!!.sharedRelatives == evidence.sharedRelatives &&
                    evidence.sharedRelatives == 0

                // A shared relative is the corroboration. Dates are not required to be *present*
                // — only not to contradict, which `score` has already established by returning at
                // all. Requiring both to carry a birth date would refuse to match two people who
                // plainly are the same simply because nobody wrote down when they were born.
                if (evidence.sharedRelatives > 0) {
                    settled[record.id] = PersonMatch(
                        record.id,
                        best.first.id,
                        MatchTier.STRONG,
                        evidence,
                    )
                    claimedLocals += best.first.id
                    changed = true
                } else if (!ambiguous) {
                    settled[record.id] = PersonMatch(
                        record.id,
                        best.first.id,
                        MatchTier.WEAK,
                        evidence,
                    )
                    // A weak match does not claim the local person: a better candidate may still
                    // turn up in a later pass.
                }
            }

        }

        return imported.map { record ->
            settled[record.id] ?: PersonMatch(record.id, null, MatchTier.NONE)
        }
    }

    /**
     * Evidence for one candidate pairing, or null when something rules it out.
     *
     * Conflicting birth dates rule it out outright — two people called Raj Kumar born eleven years
     * apart are two people, and merging them would be the single most destructive thing an import
     * could do.
     */
    private fun score(
        record: PersonRecord,
        candidate: Person,
        importedGraph: MatchGraph,
        localGraph: MatchGraph,
        settled: Map<String, PersonMatch>,
    ): MatchEvidence? {
        val importedBirth = PartialDate.parse(record.birthDate)
        val localBirth = PartialDate.parse(candidate.birthDate)
        val bothKnown = importedBirth != null && localBirth != null
        if (bothKnown && !importedBirth.isCompatibleWith(localBirth)) return null

        val importedDeath = PartialDate.parse(record.deathDate)
        val localDeath = PartialDate.parse(candidate.deathDate)
        if (importedDeath != null && localDeath != null &&
            !importedDeath.isCompatibleWith(localDeath)
        ) {
            return null
        }

        val localNeighbours = localGraph.neighbours[candidate.id].orEmpty()
        val shared = importedGraph.neighbours[record.id].orEmpty().count { neighbour ->
            val matchedLocal = settled[neighbour]?.localId
            matchedLocal != null && matchedLocal in localNeighbours
        }

        return MatchEvidence(
            sameName = true,
            // Only claim the dates agree when there were dates to agree; this is shown to the
            // user as reasoning, so it must not overstate what is known.
            datesAgree = bothKnown,
            sharedRelatives = shared,
        )
    }
}
