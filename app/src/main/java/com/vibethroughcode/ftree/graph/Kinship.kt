package com.vibethroughcode.ftree.graph

import com.vibethroughcode.ftree.data.Gender
import com.vibethroughcode.ftree.data.PartialDate
import com.vibethroughcode.ftree.data.Person

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

    /* ------------------------------------------------------------------ by marriage */

    /** Married to the subject. */
    data object Spouse : KinshipTerm

    /**
     * Married to a blood relative of the subject — an uncle's wife, a sister's husband.
     *
     * English names several of these outright: the wife of an uncle is an aunt, the husband of a
     * sister a brother-in-law. Where it has no word, [relative] still says exactly who they married,
     * which is a better answer than "related by marriage" and shorter than the chain.
     */
    data class SpouseOf(val relative: KinshipTerm) : KinshipTerm

    /** A blood relative of the subject's own spouse — a wife's mother, a husband's sister. */
    data class OfSpouse(val relative: KinshipTerm) : KinshipTerm
}

/**
 * Whether the other person's line is elder or younger where the two lines part.
 *
 * Claimed only when the record proves it. Two brothers both recorded as "1962" are [UNKNOWN], not a
 * coin toss — the whole point of carrying this is to say चाचा only when he really is the younger one.
 */
enum class Seniority { ELDER, YOUNGER, UNKNOWN }

/**
 * The people a relationship was measured *through*, as genders.
 *
 * [KinshipTerm] is two distances, which is all English needs: an uncle is an uncle whichever parent
 * he belongs to. Most of the world's languages are not like that. Hindi has five words where English
 * has one, and choosing between them needs to know which parent the line went up through, who it
 * came back down through, and — for चाचा against ताऊ — which of the two was born first.
 *
 * So the distances stay exactly as they were and this rides alongside them, carrying the part the
 * arithmetic threw away. A vocabulary that does not need it can ignore it entirely.
 *
 * It describes whatever the term was measured over, which for a relationship through marriage is the
 * *blood* part of it: for "my uncle's wife" the path runs from the subject to the uncle, because the
 * uncle is who decides the word.
 */
data class KinshipPath(
    /** Going up from the subject: their own parent first, the shared ancestor last. */
    val ascent: List<Gender>,
    /** Coming back down: the ancestor's child first, the other person last. */
    val descent: List<Gender>,
    val seniority: Seniority,
) {
    /** Which of the subject's parents the line went up through, if the record says. */
    val side: Gender get() = ascent.firstOrNull() ?: Gender.UNSPECIFIED

    /** Who the line comes back down through on the other side — the linking sibling, child or aunt. */
    val link: Gender get() = descent.firstOrNull() ?: Gender.UNSPECIFIED
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
     * @param path the people [term] was measured through, for vocabularies that need them.
     */
    data class Found(
        val chain: List<RelationStep>,
        val term: KinshipTerm?,
        val sharedAncestorId: String?,
        val path: KinshipPath? = null,
    ) : Relation {
        /** The people the chain passes through, including both ends. */
        fun peopleInvolved(fromId: String): Set<String> =
            buildSet { add(fromId); chain.forEach { add(it.personId) } }

        /**
         * The people a *chart* needs before it can draw this relation.
         *
         * The chain alone is not always drawable. Siblings are derived from the parent they share,
         * so a sibling step carries no edge of its own: draw only the chain and two siblings arrive
         * as two loose cards with nothing between them, which is precisely the question the reader
         * asked. Their shared parent is the missing element, so it is drawn even though nobody
         * would say it aloud when naming the relationship — "my father's sister" needs my
         * grandfather on the page, and does not need him in the sentence.
         *
         * Nothing else is added. Everybody here is on the line or holds it together.
         */
        fun peopleToDraw(snapshot: FamilySnapshot, fromId: String): Set<String> = buildSet {
            addAll(peopleInvolved(fromId))
            var previous = fromId
            chain.forEach { step ->
                if (step.kind == StepKind.SIBLING) {
                    val mine = snapshot.parentsOf[previous].orEmpty()
                    val theirs = snapshot.parentsOf[step.personId].orEmpty().toSet()
                    // An explicit sibling edge has no parents to add, and needs none: it carries
                    // its own bracket, drawn exactly because the parents are not known.
                    addAll(mine.filter { it in theirs })
                }
                previous = step.personId
            }
        }

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
        val standIns = standInAncestors(snapshot)
        val shared = nearestSharedAncestor(snapshot, fromId, toId, standIns)

        // Blood first, always: two people who share an ancestor are named through him even if a
        // marriage happens to join them by a shorter route.
        val affinal = if (shared == null) affinalTerm(snapshot, fromId, toId, chain, standIns) else null

        return Relation.Found(
            chain = chain,
            term = shared?.let { termFor(it.up, it.down) } ?: affinal?.term,
            sharedAncestorId = shared?.ancestorId,
            path = shared?.let { pathOf(snapshot, it) } ?: affinal?.path,
        )
    }

    /** The genders along a measured relationship, and who was born first where it forks. */
    private fun pathOf(snapshot: FamilySnapshot, shared: Shared): KinshipPath {
        fun genderOf(id: String) = snapshot.people[id]?.gender ?: Gender.UNSPECIFIED
        return KinshipPath(
            ascent = shared.ascent.map(::genderOf),
            descent = shared.descent.map(::genderOf),
            seniority = seniorityAt(snapshot, shared),
        )
    }

    /**
     * Which of the two lines leaving the shared ancestor belongs to the elder child.
     *
     * The comparison is between the ancestor's two children the lines run through — for an uncle,
     * the subject's own parent against the uncle himself. When the lines part at the subject (their
     * own sibling) the subject *is* that child.
     *
     * Only an ordering the dates actually prove counts. Two brothers both recorded as "1962" could
     * be either way round, and the app would rather say "father's brother" than pick one.
     */
    private fun seniorityAt(snapshot: FamilySnapshot, shared: Shared): Seniority {
        if (shared.up < 1 || shared.down < 1) return Seniority.UNKNOWN
        val mineId =
            if (shared.up == 1) shared.subjectId else shared.ascent.getOrNull(shared.up - 2)
        val mine = snapshot.people[mineId] ?: return Seniority.UNKNOWN
        val theirs = snapshot.people[shared.descent.first()] ?: return Seniority.UNKNOWN
        return seniorityOf(theirs, mine)
    }

    /** [other] against [subject]: elder only when the recorded dates cannot overlap. */
    fun seniorityOf(other: Person, subject: Person): Seniority {
        val a = PartialDate.parse(other.birthDate) ?: return Seniority.UNKNOWN
        val b = PartialDate.parse(subject.birthDate) ?: return Seniority.UNKNOWN
        return when {
            a.latest().isBefore(b.earliest()) -> Seniority.ELDER
            b.latest().isBefore(a.earliest()) -> Seniority.YOUNGER
            else -> Seniority.UNKNOWN
        }
    }

    /**
     * The word for a relationship that runs through exactly one marriage.
     *
     * A marriage at one *end* of the line is nameable: everyone on the far side of it is a blood
     * relative of somebody, and English hangs a word off that — my uncle's wife is my aunt, my
     * wife's mother my mother-in-law. A marriage in the *middle* is not, and no amount of wanting
     * makes it so: "my aunt's husband's brother" is what he is, and the chain says it better than
     * any invented word could. Two marriages are the same story twice over.
     *
     * So this names the two ends and returns nothing for the rest, which is the honest answer and
     * the one the screen is built to fall back to.
     */
    /** A term through marriage, with the path over the blood half of it. */
    private data class Affinal(val term: KinshipTerm, val path: KinshipPath?)

    private fun affinalTerm(
        snapshot: FamilySnapshot,
        fromId: String,
        toId: String,
        chain: List<RelationStep>,
        standIns: Map<String, String>,
    ): Affinal? {
        if (chain.count { it.kind == StepKind.SPOUSE } != 1) return null
        val at = chain.indexOfFirst { it.kind == StepKind.SPOUSE }

        // The whole line is one marriage: they are simply married to each other.
        if (chain.size == 1) return Affinal(KinshipTerm.Spouse, null)

        return when (at) {
            // ...married to the person the line reaches just before them. The path runs to *them*,
            // because it is the blood relative who decides the word: फूफा is the husband of a
            // father's sister, and nothing about him says so except who he married.
            chain.lastIndex -> {
                val married = chain[chain.size - 2].personId
                nearestSharedAncestor(snapshot, fromId, married, standIns)?.let {
                    Affinal(KinshipTerm.SpouseOf(termFor(it.up, it.down)), pathOf(snapshot, it))
                }
            }
            // ...a blood relative of the subject's own spouse. Measured from the spouse, so
            // seniority compares the two of them — which is what tells जेठ from देवर.
            0 -> {
                val spouse = chain.first().personId
                nearestSharedAncestor(snapshot, spouse, toId, standIns)?.let {
                    Affinal(KinshipTerm.OfSpouse(termFor(it.up, it.down)), pathOf(snapshot, it))
                }
            }
            else -> null
        }
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

    private data class Shared(
        val subjectId: String,
        val ancestorId: String,
        val up: Int,
        val down: Int,
        /** The subject's parent first, the ancestor last. Empty when the subject *is* the ancestor. */
        val ascent: List<String>,
        /** The ancestor's child first, the other person last. Empty when they are the ancestor. */
        val descent: List<String>,
    )

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
        val mine = ancestorRoutes(snapshot, fromId, standIns)
        val theirs = ancestorRoutes(snapshot, toId, standIns)
        var best: Shared? = null
        mine.forEach { (ancestor, ascent) ->
            val theirRoute = theirs[ancestor] ?: return@forEach
            val up = ascent.size
            val down = theirRoute.size
            val current = best
            if (current == null ||
                up + down < current.up + current.down ||
                (up + down == current.up + current.down &&
                    kotlin.math.abs(up - down) < kotlin.math.abs(current.up - current.down))
            ) {
                best = Shared(
                    subjectId = fromId,
                    ancestorId = ancestor,
                    up = up,
                    down = down,
                    ascent = ascent,
                    // Their route runs upward and stops at the ancestor; the descent is that read
                    // backwards, the ancestor dropped and the person themself added at the end.
                    descent = if (down == 0) emptyList() else theirRoute.dropLast(1).reversed() + toId,
                )
            }
        }
        return best
    }

    /**
     * Everyone at or above [id], with the line of people leading up to each.
     *
     * The route rather than only its length, because which parent a line went up through is exactly
     * what separates a मामा from a चाचा. The list excludes [id] and ends with the ancestor, so its
     * size is the number of generations — the distance this used to return.
     */
    private fun ancestorRoutes(
        snapshot: FamilySnapshot,
        id: String,
        standIns: Map<String, String>,
    ): Map<String, List<String>> {
        val routes = linkedMapOf(id to emptyList<String>())
        val queue = ArrayDeque(listOf(id))
        while (queue.isNotEmpty()) {
            val current = queue.removeFirst()
            val soFar = routes.getValue(current)
            val above = snapshot.parentsOf[current].orEmpty() + listOfNotNull(standIns[current])
            above.forEach { parent ->
                // The visited check also makes a cycle in bad data terminate rather than hang.
                if (routes.putIfAbsent(parent, soFar + parent) == null) queue.addLast(parent)
            }
        }
        return routes
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
