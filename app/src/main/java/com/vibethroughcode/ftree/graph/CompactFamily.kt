package com.vibethroughcode.ftree.graph

import com.vibethroughcode.ftree.data.PartialDate
import com.vibethroughcode.ftree.data.Person

/**
 * One block on a row: a person, a couple, or somebody with the two people they married.
 *
 * The chart lays a marriage out as a single unit joined by a doubled rule, because a couple that
 * drifts apart on screen stops looking like a couple. There are no coordinates here to drift, so
 * the same idea is expressed in the data: everybody joined by a marriage on this row comes out as
 * one group, in the order they are read across it.
 *
 * [links] says which neighbours are actually married — `links[i]` joins `people[i]` to
 * `people[i + 1]`. It is not always every gap. Somebody who married twice puts three people in one
 * group, and only two of the three pairs are marriages; drawing the mark between all of them would
 * state a wedding that never happened.
 *
 * [ofBand] is who belongs to the row by *descent*. A step-grandmother is family and is shown, but
 * she is not a fifth grandparent, and the heading counts grandparents.
 */
data class CompactGroup(
    val people: List<Person>,
    val links: List<Boolean>,
    val ofBand: Set<String>,
) {
    val ids: List<String> get() = people.map { it.id }

    /** True when [people] `[index]` and `[index + 1]` are married to each other. */
    fun married(index: Int): Boolean = links.getOrElse(index) { false }
}

/**
 * One generation, at a distance from the person the view is centred on.
 *
 * [offset] is generations from the focus: -1 is their parents, +1 their children, 0 the row they
 * stand in themselves. Bands are keyed by the number rather than by a name, so "three generations
 * up" needs no new case — the heading is worked out from the offset when it is drawn.
 */
data class CompactBand(
    val offset: Int,
    val groups: List<CompactGroup>,
) {
    /** What the heading counts: people who are of this generation, not married into it. */
    val count: Int get() = groups.sumOf { it.ofBand.size }

    val isEmpty: Boolean get() = groups.isEmpty()
}

/**
 * A person and whoever they married, for the one place a couple is read downwards.
 *
 * The centre of the view is a block of its own rather than a card in a row, so its marriages are
 * listed under it and each is unambiguous. The bands need [CompactGroup] instead, because there a
 * couple runs across the page.
 */
data class CompactMember(
    val person: Person,
    val partners: List<Person> = emptyList(),
) {
    val ids: List<String> get() = listOf(person.id) + partners.map { it.id }
}

/**
 * One person's family, arranged for reading rather than for drawing.
 *
 * This is the third answer the tree screen gives, and the only one that is composed rather than
 * painted. The two charts are pictures: to read a name you pinch, to reach a relative you pan, and
 * a canvas holds nothing at all for a screen reader — which is why the chart describes itself and
 * then points at the people list. But that list is alphabetical and has no family in it. Between
 * "a picture you must zoom" and "a list with no shape" there was nothing, and this is the missing
 * middle: the same people the focused chart draws, as text that can be read at any size.
 *
 * Built from the layout the chart has already produced rather than from a second walk of the graph.
 * The rules about who appears — ancestors, descendants, the focus's siblings, everyone's partners,
 * and deliberately *not* cousins or nieces — are subtle and live in [TreeLayoutEngine]. Deriving
 * from its output means the two views cannot drift into showing different families, and switching
 * between them costs nothing because nothing is loaded twice.
 */
data class CompactFamily(
    /** The person the view is centred on, with their partners. Null when there is nobody. */
    val focus: CompactMember? = null,
    /** Every other generation, oldest first, including the focus's own row as offset 0. */
    val bands: List<CompactBand> = emptyList(),
    /** True when the record continues past the generations that were loaded. */
    val truncated: Boolean = false,
) {
    val isEmpty: Boolean get() = focus == null

    fun band(offset: Int): CompactBand? = bands.firstOrNull { it.offset == offset }

    /** Generations above the focus, oldest first. */
    val ancestors: List<CompactBand> get() = bands.filter { it.offset < 0 }

    /** Generations below the focus, nearest first. */
    val descendants: List<CompactBand> get() = bands.filter { it.offset > 0 }

    /** The focus's own row, without the focus or their partners: brothers and sisters. */
    val siblings: CompactBand? get() = band(0)

    /** Everybody shown, focus included. Used to check this view against the chart it came from. */
    val everyone: List<String>
        get() = focus?.ids.orEmpty() + bands.flatMap { band -> band.groups.flatMap { it.ids } }

    companion object {

        /**
         * Rearranges a laid-out chart into generation bands.
         *
         * The chart supplies who is on screen and which row they stand in; the snapshot supplies
         * the marriages, which the layout expresses only as coordinates. Pure, so it runs on the
         * same background pass that produced the layout, and is tested on the JVM.
         */
        fun from(snapshot: FamilySnapshot, layout: TreeLayout): CompactFamily {
            val focusId = layout.focusId ?: return CompactFamily()
            val focusPerson = layout.node(focusId)?.person ?: return CompactFamily()

            val levelOf = layout.nodes.associate { it.person.id to it.level }
            val personById = layout.nodes.associate { it.person.id to it.person }
            val peopleByLevel = layout.nodes.groupBy({ it.level }, { it.person.id })

            /*
             * Who belongs to a row by descent, as opposed to by marriage.
             *
             * Walked one generation at a time from the focus's own row outwards, following the same
             * lines the chart followed: parents of the row above, children of the row below. A
             * spouse is reached by neither, which is exactly what makes them a partner — and is how
             * a step-grandparent stays visible without being counted as a grandparent.
             */
            val ownRow = buildSet {
                add(focusId)
                addAll(snapshot.siblingsOf[focusId].orEmpty().filter { levelOf[it] == 0 })
            }
            val descentAt = mutableMapOf(0 to ownRow)

            var frontier = ownRow
            var row = -1
            while (peopleByLevel.containsKey(row)) {
                frontier = frontier
                    .flatMap { snapshot.parentsOf[it].orEmpty() }
                    .filterTo(mutableSetOf()) { levelOf[it] == row }
                descentAt[row] = frontier
                row--
            }

            frontier = ownRow
            row = 1
            while (peopleByLevel.containsKey(row)) {
                frontier = frontier
                    .flatMap { snapshot.childrenOf[it].orEmpty() }
                    .filterTo(mutableSetOf()) { levelOf[it] == row }
                descentAt[row] = frontier
                row++
            }

            val focus = CompactMember(
                person = focusPerson,
                partners = snapshot.spousesOf[focusId].orEmpty()
                    .filter { levelOf[it] == 0 }
                    .mapNotNull(personById::get)
                    .sortedWith(readingOrder),
            )

            // The centre is drawn as the view's own block, so its row lists only who stands beside
            // it. Everybody else on that row still appears.
            val spokenFor = focus.ids.toSet()

            val bands = peopleByLevel.keys.sorted().mapNotNull { level ->
                val here = peopleByLevel.getValue(level)
                    .filterTo(mutableSetOf()) { level != 0 || it !in spokenFor }
                val byDescent = descentAt[level].orEmpty().filterTo(mutableSetOf()) { it in here }

                val groups = marriageGroups(here, snapshot)
                    .map { group ->
                        val order = readAcross(group, byDescent, snapshot)
                        CompactGroup(
                            people = order.mapNotNull(personById::get),
                            links = order.zipWithNext { a, b -> b in snapshot.spousesOf[a].orEmpty() },
                            ofBand = order.filterTo(mutableSetOf()) { it in byDescent },
                        )
                    }
                    .sortedWith(groupOrder(personById))

                if (groups.isEmpty()) null else CompactBand(level, groups)
            }

            return CompactFamily(focus = focus, bands = bands, truncated = layout.truncated)
        }

        /** Everyone on a row who is joined, directly or through somebody else, by a marriage. */
        private fun marriageGroups(
            row: Set<String>,
            snapshot: FamilySnapshot,
        ): List<Set<String>> {
            val remaining = row.toMutableSet()
            val groups = mutableListOf<Set<String>>()
            while (remaining.isNotEmpty()) {
                val seed = remaining.first()
                val group = mutableSetOf(seed)
                val queue = ArrayDeque(listOf(seed))
                while (queue.isNotEmpty()) {
                    snapshot.spousesOf[queue.removeFirst()].orEmpty()
                        .filter { it in remaining && group.add(it) }
                        .forEach { queue += it }
                }
                remaining -= group
                groups += group
            }
            return groups
        }

        /**
         * The order a marriage group is read across the row.
         *
         * Walked along the marriages themselves, starting from somebody at the end of the chain, so
         * that a person who married twice ends up *between* their two spouses rather than beside
         * one of them with the other stranded. That is what lets the doubled rule be drawn only
         * where there really is a marriage.
         *
         * Where the chain could start at either end it starts with somebody the band is about, so a
         * row of brothers and sisters leads with the sister rather than with the man she married.
         * Remaining ties break on birth and then on id: a row that reshuffles itself when the
         * screen rotates is disorienting for no reason.
         */
        private fun readAcross(
            group: Set<String>,
            byDescent: Set<String>,
            snapshot: FamilySnapshot,
        ): List<String> {
            if (group.size <= 1) return group.toList()
            val within = group.associateWith { id ->
                snapshot.spousesOf[id].orEmpty().filter { it in group }.sorted()
            }
            val start = group.sortedWith(
                compareBy(
                    { within.getValue(it).size },
                    { if (it in byDescent) 0 else 1 },
                    { birthOf(it, snapshot) },
                    { it },
                )
            ).first()

            val order = mutableListOf<String>()
            val seen = mutableSetOf<String>()
            val queue = ArrayDeque(listOf(start))
            while (queue.isNotEmpty()) {
                val next = queue.removeFirst()
                if (!seen.add(next)) continue
                order += next
                within.getValue(next)
                    .filterNot { it in seen }
                    .sortedWith(compareBy({ within.getValue(it).size }, { birthOf(it, snapshot) }))
                    .forEach { queue.addFirst(it) }
            }
            // Anyone the walk could not reach — impossible for a connected group, but the row is
            // more useful missing a mark than missing a person.
            order += group.filterNot { it in seen }.sorted()
            return order
        }

        private fun birthOf(id: String, snapshot: FamilySnapshot): Int =
            snapshot.people[id]?.birthDate?.let { PartialDate.parse(it)?.year } ?: Int.MAX_VALUE

        /**
         * Groups run oldest first, judged on the people the band is actually about.
         *
         * Birth order is how a family lists a generation aloud, and since the Hindi work it is a
         * kinship fact in its own right — an elder and a younger brother are different words.
         * Someone with no recorded birth year sorts last, so an undated placeholder never displaces
         * the eldest.
         */
        private fun groupOrder(people: Map<String, Person>) = compareBy<CompactGroup>(
            { group ->
                val counted = group.ofBand.ifEmpty { group.ids.toSet() }
                counted.minOf { id -> people[id]?.birth?.year ?: Int.MAX_VALUE }
            },
            { group -> group.people.firstOrNull()?.name?.lowercase() ?: "￿" },
            { group -> group.ids.first() },
        )

        private val readingOrder = compareBy<Person>(
            { it.birth?.year ?: Int.MAX_VALUE },
            { it.name?.lowercase() ?: "￿" },
            { it.id },
        )
    }
}
