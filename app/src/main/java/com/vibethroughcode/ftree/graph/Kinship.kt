package com.vibethroughcode.ftree.graph

/**
 * How any two people in a tree are related.
 *
 * Two questions, answered separately because they have different failure modes. *What is the word
 * for it* — "first cousin once removed" — only exists when the two share a blood ancestor, and
 * English simply has no term for most of the ways a family actually connects. *Which people join
 * them* always exists whenever the record joins them at all, and is the answer that can be checked
 * against the tree by eye.
 *
 * So a relation always carries the chain, and carries a term only when there is one. Nothing here
 * knows any English: the term is a structure the UI names alongside the rest of its labels, so the
 * words for a family live in one place rather than two.
 */

/** The kind of step taken from one person to the next along a chain. */
enum class StepKind { PARENT, CHILD, SPOUSE, SIBLING }

/** One link in the chain: the person arrived at, and what they are to the person before them. */
data class RelationStep(val personId: String, val kind: StepKind)

/**
 * The English kinship term for a blood relationship, as a structure rather than a string.
 *
 * Everything a family says out loud falls out of two numbers: how many generations *up* from the
 * subject to the ancestor they share, and how many back *down* to the other person.
 */
sealed interface KinshipTerm {
    data object Self : KinshipTerm

    /** 1 = parent, 2 = grandparent, 3 = great-grandparent. */
    data class Ancestor(val generations: Int) : KinshipTerm

    /** 1 = child, 2 = grandchild, 3 = great-grandchild. */
    data class Descendant(val generations: Int) : KinshipTerm

    data object Sibling : KinshipTerm

    /** Aunt or uncle. [greats] 0 = aunt, 1 = great-aunt. */
    data class ParentsSibling(val greats: Int) : KinshipTerm

    /** Niece or nephew. [greats] 0 = niece, 1 = great-niece. */
    data class SiblingsChild(val greats: Int) : KinshipTerm

    /** [degree] 1 = first cousin. [removed] 0 = of the same generation. */
    data class Cousin(val degree: Int, val removed: Int) : KinshipTerm
}

/** The answer to "how are these two related?". */
sealed interface Relation {
    /** The same person was picked twice. */
    data object SamePerson : Relation

    /** Nothing in the record joins them — which is not the same as knowing they are unrelated. */
    data object Unrecorded : Relation

    /**
     * @param chain every step from the subject to the other person, the other person last.
     * @param term the blood term, absent when no shared ancestor exists — in-laws and step-family.
     * @param sharedAncestorId the ancestor [term] was measured through.
     */
    data class Found(
        val chain: List<RelationStep>,
        val term: KinshipTerm?,
        val sharedAncestorId: String?,
    ) : Relation {
        /** The people the chain passes through, including both ends. */
        fun peopleInvolved(fromId: String): Set<String> =
            buildSet { add(fromId); chain.forEach { add(it.personId) } }

        /** Joined only by a marriage somewhere along the way, with no blood between them. */
        val byMarriage: Boolean
            get() = term == null && chain.any { it.kind == StepKind.SPOUSE }

        val steps: Int get() = chain.size
    }
}

object Kinship {

    /**
     * Relates [toId] to [fromId] — the term reads "B is A's ...", in that order.
     */
    fun relate(snapshot: FamilySnapshot, fromId: String, toId: String): Relation {
        if (fromId == toId) {
            return if (fromId in snapshot.people) Relation.SamePerson else Relation.Unrecorded
        }
        if (fromId !in snapshot.people || toId !in snapshot.people) return Relation.Unrecorded

        val chain = shortestChain(snapshot, fromId, toId) ?: return Relation.Unrecorded
        val shared = nearestSharedAncestor(snapshot, fromId, toId, standInAncestors(snapshot))
        return Relation.Found(
            chain = chain,
            term = shared?.let { termFor(it.up, it.down) },
            sharedAncestorId = shared?.ancestorId,
        )
    }

    /**
     * The word for a blood relationship, from the two distances to a shared ancestor.
     *
     * @param up generations from the subject to the ancestor.
     * @param down generations from that ancestor back to the other person.
     */
    fun termFor(up: Int, down: Int): KinshipTerm = when {
        up == 0 && down == 0 -> KinshipTerm.Self
        up == 0 -> KinshipTerm.Descendant(down)
        down == 0 -> KinshipTerm.Ancestor(up)
        up == 1 && down == 1 -> KinshipTerm.Sibling
        down == 1 -> KinshipTerm.ParentsSibling(greats = up - 2)
        up == 1 -> KinshipTerm.SiblingsChild(greats = down - 2)
        else -> KinshipTerm.Cousin(
            degree = minOf(up, down) - 1,
            removed = kotlin.math.abs(up - down),
        )
    }

    private data class Shared(val ancestorId: String, val up: Int, val down: Int)

    /**
     * The shared ancestor that names the relationship.
     *
     * Nearest first, and among equally near ones the most symmetric pair of distances — which is
     * what picks the grandparent two cousins share over the great-grandparent they also share.
     */
    private fun nearestSharedAncestor(
        snapshot: FamilySnapshot,
        fromId: String,
        toId: String,
        standIns: Map<String, String>,
    ): Shared? {
        val mine = ancestorDistances(snapshot, fromId, standIns)
        val theirs = ancestorDistances(snapshot, toId, standIns)
        var best: Shared? = null
        mine.forEach { (ancestor, up) ->
            val down = theirs[ancestor] ?: return@forEach
            val current = best
            if (current == null ||
                up + down < current.up + current.down ||
                (up + down == current.up + current.down &&
                    kotlin.math.abs(up - down) < kotlin.math.abs(current.up - current.down))
            ) {
                best = Shared(ancestor, up, down)
            }
        }
        return best
    }

    /** Everyone at or above [id], with the number of generations up to each. */
    private fun ancestorDistances(
        snapshot: FamilySnapshot,
        id: String,
        standIns: Map<String, String>,
    ): Map<String, Int> {
        val distance = linkedMapOf(id to 0)
        val queue = ArrayDeque(listOf(id))
        while (queue.isNotEmpty()) {
            val current = queue.removeFirst()
            val step = distance.getValue(current) + 1
            val above = snapshot.parentsOf[current].orEmpty() + listOfNotNull(standIns[current])
            above.forEach { parent ->
                // The visited check also makes a cycle in bad data terminate rather than hang.
                if (distance.putIfAbsent(parent, step) == null) queue.addLast(parent)
            }
        }
        return distance
    }

    /**
     * A stand-in parent for each group of people joined by explicit sibling edges.
     *
     * A SIBLING edge is only ever recorded when the parents are *not* known — shared parents derive
     * siblings on their own. So an explicit edge is a statement that these people share an ancestor
     * whom nobody wrote down, and without somebody to measure through, the term calculation has
     * nothing to work with: an aunt comes back as merely "related", the gap in the record
     * swallowing a word the family uses every day.
     *
     * The stand-in is never shown. It has no name to show, which is the whole point of it, and the
     * screen already declines to name an ancestor it cannot look up.
     */
    private fun standInAncestors(snapshot: FamilySnapshot): Map<String, String> {
        if (snapshot.siblingEdges.isEmpty()) return emptyMap()

        // Whole groups, not pairs: three siblings recorded as two edges share one unknown parent,
        // and minting two stand-ins would make one of them their own cousin.
        val groupOf = HashMap<String, String>()
        val members = HashMap<String, MutableList<String>>()
        snapshot.siblingEdges.forEach { (a, b) ->
            if (a !in snapshot.people || b !in snapshot.people) return@forEach
            val left = groupOf[a]
            val right = groupOf[b]
            when {
                left == null && right == null -> {
                    val id = "unrecorded-parent:" + groupOf.size
                    groupOf[a] = id
                    groupOf[b] = id
                    members[id] = mutableListOf(a, b)
                }
                left == null -> { groupOf[a] = right!!; members.getValue(right)+= a }
                right == null -> { groupOf[b] = left; members.getValue(left) += b }
                left != right -> {
                    members.getValue(right).forEach { groupOf[it] = left }
                    members.getValue(left).addAll(members.remove(right).orEmpty())
                }
            }
        }
        return groupOf
    }

    /**
     * The shortest chain of relationships joining two people, over every kind of edge.
     *
     * Marriage is walked as well as blood, because "my wife's mother" is exactly the sort of
     * question this feature is asked, and no blood-only search can answer it. Blood steps are
     * enqueued before marriage ones so that where two routes are the same length the one through
     * the family wins — arriving at a cousin through their spouse would be a true answer and a
     * useless one.
     */
    private fun shortestChain(
        snapshot: FamilySnapshot,
        fromId: String,
        toId: String,
    ): List<RelationStep>? {
        val cameFrom = HashMap<String, RelationStep>()
        val previous = HashMap<String, String>()
        val queue = ArrayDeque(listOf(fromId))
        val seen = hashSetOf(fromId)

        while (queue.isNotEmpty()) {
            val current = queue.removeFirst()
            if (current == toId) break

            val neighbours = sequence {
                snapshot.parentsOf[current].orEmpty().forEach { yield(it to StepKind.PARENT) }
                snapshot.childrenOf[current].orEmpty().forEach { yield(it to StepKind.CHILD) }
                snapshot.siblingsOf[current].orEmpty().forEach { yield(it to StepKind.SIBLING) }
                snapshot.spousesOf[current].orEmpty().forEach { yield(it to StepKind.SPOUSE) }
            }
            neighbours.forEach { (next, kind) ->
                if (next !in snapshot.people || !seen.add(next)) return@forEach
                cameFrom[next] = RelationStep(next, kind)
                previous[next] = current
                queue.addLast(next)
            }
        }

        if (toId !in cameFrom) return null
        val chain = ArrayDeque<RelationStep>()
        var cursor = toId
        while (cursor != fromId) {
            chain.addFirst(cameFrom.getValue(cursor))
            cursor = previous.getValue(cursor)
        }
        return chain.toList()
    }
}
