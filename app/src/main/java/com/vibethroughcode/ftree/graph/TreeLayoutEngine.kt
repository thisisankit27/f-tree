package com.vibethroughcode.ftree.graph

import com.vibethroughcode.ftree.data.PartialDate
import com.vibethroughcode.ftree.data.Person
import kotlin.math.max

/**
 * Arranges a slice of the family graph into a readable genealogical chart, drawn sideways.
 *
 * The chart is ego-centric on purpose. Laying out an entire family produces something no phone can
 * show and no person can read, so this draws one person's ancestors before them and descendants
 * after, with their siblings beside them, and everyone else is reached by re-focusing. That also
 * keeps the work proportional to what is on screen rather than to the size of the tree.
 *
 * **A generation is a column, not a row** — the same way round as [WholeTreeLayoutEngine], and for
 * the same reason. A person with six children and three generations below them makes a chart 45
 * cards wide and 3 tall, which is a ribbon on a phone however well it is packed; the width is the
 * widest generation and nothing else, so the only thing that changes the shape is turning it. Read
 * left to right, the long axis becomes the one a phone scrolls, and the two charts agree about
 * which way a family runs — a reader should not have to relearn the picture when they switch.
 *
 * Pure: it takes a loaded [FamilySnapshot] and returns coordinates. No database, no Compose, so it
 * runs off the main thread and is tested directly on the JVM.
 */
object TreeLayoutEngine {

    /**
     * A person drawn together with their partners.
     *
     * Couples are laid out as one block rather than as independent nodes, because a marriage that
     * drifts apart on screen stops looking like a marriage, and children need a single point to
     * descend from. Stacked, since the couple shares a generation and a generation is a column.
     */
    private class Unit(val members: List<String>, val nodeHeight: Float) {
        /** Position along the generation, which is down the screen. */
        var across = 0f

        val extent: Float
            get() = members.size * nodeHeight + (members.size - 1) * TreeMetrics.COUPLE_GAP

        fun acrossOf(personId: String): Float =
            across + members.indexOf(personId) * (nodeHeight + TreeMetrics.COUPLE_GAP)

        val centerAcross: Float get() = across + extent / 2f
    }

    fun layout(
        snapshot: FamilySnapshot,
        focusId: String,
        generationsUp: Int = 3,
        generationsDown: Int = 3,
        nodeWidth: Float = TreeMetrics.NODE_WIDTH,
        nodeHeight: Float = TreeMetrics.NODE_HEIGHT,
    ): TreeLayout {
        val columnPitch = nodeWidth + TreeMetrics.GENERATION_GAP
        if (focusId !in snapshot.people) return TreeLayout()

        val included = collect(snapshot, focusId, generationsUp, generationsDown)
        val levels = included.levels

        // --- Build the units, one per person-and-partners group, per generation. ---
        val unitOf = mutableMapOf<String, Unit>()
        val unitsByLevel = mutableMapOf<Int, MutableList<Unit>>()
        levels.entries.groupBy({ it.value }, { it.key }).forEach { (level, ids) ->
            buildUnits(ids.toSet(), snapshot, nodeHeight).forEach { unit ->
                unit.members.forEach { unitOf[it] = unit }
                unitsByLevel.getOrPut(level) { mutableListOf() } += unit
            }
        }

        val focusUnit = unitOf[focusId] ?: return TreeLayout()

        // --- The focus's own generation: they and their siblings, in birth order. ---
        val row0 = unitsByLevel[0] ?: mutableListOf()
        orderByBirth(row0, snapshot)

        // Siblings sit directly beside the focus. Their own descendants are not drawn (see
        // `collect`), so the focus's subtree can spread out in the columns after without ever
        // colliding with them — reserving the subtree's whole extent here would only shove the
        // siblings, and the ancestors centred beside them, far off to one side.
        var cursor = 0f
        row0.forEach { unit ->
            unit.across = cursor
            cursor += unit.extent + TreeMetrics.STACK_GAP
        }

        placeDescendants(focusUnit, unitOf, unitsByLevel, snapshot, included)
        placeAncestors(row0, unitOf, unitsByLevel, snapshot, included)

        // --- Normalise so the chart starts at the margin. ---
        val allUnits = unitsByLevel.values.flatten()
        val minAcross = allUnits.minOfOrNull { it.across } ?: 0f
        val minLevel = levels.values.minOrNull() ?: 0
        allUnits.forEach { it.across += TreeMetrics.MARGIN - minAcross }

        fun xOf(level: Int) = TreeMetrics.MARGIN + (level - minLevel) * columnPitch

        val nodes = levels.mapNotNull { (id, level) ->
            val person = snapshot.people[id] ?: return@mapNotNull null
            TreeNode(
                person = person,
                level = level,
                x = xOf(level),
                y = unitOf.getValue(id).acrossOf(id),
                isFocus = id == focusId,
                width = nodeWidth,
                height = nodeHeight,
            )
        }.sortedBy { it.level }

        return TreeLayout(
            nodes = nodes,
            spouseLinks = spouseLinks(unitsByLevel, nodeWidth, nodeHeight, ::xOf),
            descentLinks = descentLinks(included, unitOf, levels, nodeWidth, nodeHeight, ::xOf),
            width = xOf(levels.values.maxOrNull() ?: 0) + nodeWidth + TreeMetrics.MARGIN,
            height = (allUnits.maxOfOrNull { it.across + it.extent } ?: 0f) + TreeMetrics.MARGIN,
            focusId = focusId,
            truncated = included.truncated,
        )
    }

    // ------------------------------------------------------------------ selection

    private class Included(
        val levels: Map<String, Int>,
        /** Child ids grouped by the exact set of parents they descend from. */
        val families: Map<Set<String>, List<String>>,
        val truncated: Boolean,
    )

    /**
     * Chooses who appears.
     *
     * Ancestors and descendants of the focus, the focus's own siblings, and the partners of all of
     * them. Deliberately *not* included: the descendants of siblings and of ancestors' siblings.
     * Cousins and nieces multiply a chart's width far faster than they add to what it tells you,
     * and they are one tap away by re-focusing.
     */
    private fun collect(
        snapshot: FamilySnapshot,
        focusId: String,
        up: Int,
        down: Int,
    ): Included {
        val levels = mutableMapOf(focusId to 0)
        var truncated = false

        fun addPartners(id: String, level: Int) {
            snapshot.spousesOf[id].orEmpty().forEach { levels.putIfAbsent(it, level) }
        }

        // The focus's siblings share the row.
        snapshot.siblingsOf[focusId].orEmpty().forEach { levels.putIfAbsent(it, 0) }
        levels.keys.toList().forEach { addPartners(it, 0) }

        // Upwards.
        var frontier = (snapshot.siblingsOf[focusId].orEmpty() + focusId).toSet()
        for (generation in 1..up) {
            val parents = frontier.flatMap { snapshot.parentsOf[it].orEmpty() }.toSet()
            if (parents.isEmpty()) break
            parents.forEach { levels.putIfAbsent(it, -generation) }
            parents.forEach { addPartners(it, -generation) }
            frontier = parents
            if (generation == up && parents.any { snapshot.parentsOf[it].orEmpty().isNotEmpty() }) {
                truncated = true
            }
        }

        // Downwards from the focus only.
        frontier = setOf(focusId)
        for (generation in 1..down) {
            val children = frontier.flatMap { snapshot.childrenOf[it].orEmpty() }.toSet()
            if (children.isEmpty()) break
            children.forEach { levels.putIfAbsent(it, generation) }
            children.forEach { addPartners(it, generation) }
            frontier = children
            if (generation == down && children.any { snapshot.childrenOf[it].orEmpty().isNotEmpty() }) {
                truncated = true
            }
        }

        // Group children by the exact parent set that is on screen, so each couple's children hang
        // from their own connector and half-siblings do not share one.
        val families = levels.keys
            .mapNotNull { child ->
                val parents = snapshot.parentsOf[child].orEmpty().filter { it in levels }.toSet()
                if (parents.isEmpty()) null else parents to child
            }
            .groupBy({ it.first }, { it.second })

        return Included(levels, families, truncated)
    }

    // ------------------------------------------------------------------ units

    private fun buildUnits(
        ids: Set<String>,
        snapshot: FamilySnapshot,
        nodeHeight: Float,
    ): List<Unit> {
        val remaining = ids.toMutableSet()
        val units = mutableListOf<Unit>()

        while (remaining.isNotEmpty()) {
            val seed = remaining.first()
            val group = mutableSetOf(seed)
            val queue = ArrayDeque(listOf(seed))
            while (queue.isNotEmpty()) {
                val next = queue.removeFirst()
                snapshot.spousesOf[next].orEmpty()
                    .filter { it in remaining && group.add(it) }
                    .forEach { queue += it }
            }
            remaining -= group

            // The person with the most partners sits in the middle, so someone who married twice
            // has a spouse above and one below rather than both crowded to one side. Ties are
            // broken by birth and then by id so the order is the same every time: a chart that
            // reshuffles its couples when the screen rotates is disorienting for no reason.
            val ordered = group.sortedWith(
                compareByDescending<String> { id ->
                    snapshot.spousesOf[id].orEmpty().count { it in group }
                }.thenBy { id ->
                    snapshot.people[id]?.birthDate?.let { PartialDate.parse(it)?.year }
                        ?: Int.MAX_VALUE
                }.thenBy { it }
            )
            val members = when (ordered.size) {
                1, 2 -> ordered
                else -> {
                    val hub = ordered.first()
                    val rest = ordered.drop(1)
                    rest.take(rest.size / 2) + hub + rest.drop(rest.size / 2)
                }
            }
            units += Unit(members, nodeHeight)
        }
        return units
    }

    private fun orderByBirth(units: MutableList<Unit>, snapshot: FamilySnapshot) {
        units.sortBy { unit ->
            unit.members.minOfOrNull { id ->
                snapshot.people[id]?.birthDate?.let { PartialDate.parse(it)?.year } ?: Int.MAX_VALUE
            } ?: Int.MAX_VALUE
        }
    }

    // ------------------------------------------------------------------ placement

    private fun childUnitsOf(
        unit: Unit,
        unitOf: Map<String, Unit>,
        snapshot: FamilySnapshot,
        included: Included,
    ): List<Unit> = unit.members
        .flatMap { snapshot.childrenOf[it].orEmpty() }
        .filter { included.levels.containsKey(it) }
        .mapNotNull { unitOf[it] }
        .distinct()

    /** How far along its generation the focus's descendants reach, before anything is positioned. */
    private fun measureDescendants(
        unit: Unit,
        unitOf: Map<String, Unit>,
        unitsByLevel: Map<Int, List<Unit>>,
        snapshot: FamilySnapshot,
        included: Included,
    ): Float {
        val children = childUnitsOf(unit, unitOf, snapshot, included)
        if (children.isEmpty()) return unit.extent
        val childrenExtent = children.sumOf {
            measureDescendants(it, unitOf, unitsByLevel, snapshot, included).toDouble()
        }.toFloat() + (children.size - 1) * TreeMetrics.STACK_GAP
        return max(unit.extent, childrenExtent)
    }

    /** Packs each generation of children into the next column, centred beside their parents. */
    private fun placeDescendants(
        unit: Unit,
        unitOf: Map<String, Unit>,
        unitsByLevel: Map<Int, List<Unit>>,
        snapshot: FamilySnapshot,
        included: Included,
    ) {
        val children = childUnitsOf(unit, unitOf, snapshot, included).toMutableList()
        if (children.isEmpty()) return
        orderByBirth(children, snapshot)

        val extents = children.map {
            measureDescendants(it, unitOf, unitsByLevel, snapshot, included)
        }
        val total = extents.sum() + (children.size - 1) * TreeMetrics.STACK_GAP
        var cursor = unit.centerAcross - total / 2f

        children.forEachIndexed { index, child ->
            child.across = cursor + (extents[index] - child.extent) / 2f
            cursor += extents[index] + TreeMetrics.STACK_GAP
            placeDescendants(child, unitOf, unitsByLevel, snapshot, included)
        }
    }

    /**
     * Places each generation of parents in the column before their children and centred beside
     * them, then pushes apart any that collide. Ancestors fan out faster than descendants, so the
     * separation sweep matters more here than the centring does.
     */
    private fun placeAncestors(
        row0: List<Unit>,
        unitOf: Map<String, Unit>,
        unitsByLevel: Map<Int, MutableList<Unit>>,
        snapshot: FamilySnapshot,
        included: Included,
    ) {
        val minLevel = included.levels.values.minOrNull() ?: 0
        var childRow = row0

        for (level in -1 downTo minLevel) {
            val row = unitsByLevel[level].orEmpty()
            if (row.isEmpty()) continue

            row.forEach { unit ->
                val theirChildren = unit.members
                    .flatMap { snapshot.childrenOf[it].orEmpty() }
                    .filter { included.levels[it] == level + 1 }
                    .mapNotNull { unitOf[it] }
                    .distinct()
                unit.across = if (theirChildren.isEmpty()) {
                    childRow.firstOrNull()?.centerAcross?.minus(unit.extent / 2f) ?: 0f
                } else {
                    theirChildren.map { it.centerAcross }.average().toFloat() - unit.extent / 2f
                }
            }

            separate(row)
            childRow = row
        }
    }

    /** Sweeps a column top to bottom, shifting anything that overlaps its neighbour. */
    private fun separate(column: List<Unit>) {
        val sorted = column.sortedBy { it.across }
        for (i in 1 until sorted.size) {
            val previous = sorted[i - 1]
            val minimum = previous.across + previous.extent + TreeMetrics.STACK_GAP
            if (sorted[i].across < minimum) sorted[i].across = minimum
        }
    }

    // ------------------------------------------------------------------ connectors

    private fun spouseLinks(
        unitsByLevel: Map<Int, List<Unit>>,
        nodeWidth: Float,
        nodeHeight: Float,
        xOf: (Int) -> Float,
    ): List<SpouseLink> = unitsByLevel.flatMap { (level, units) ->
        units.flatMap { unit ->
            unit.members.zipWithNext { a, b ->
                SpouseLink(
                    x = xOf(level) + nodeWidth / 2f,
                    fromY = unit.acrossOf(a) + nodeHeight,
                    toY = unit.acrossOf(b),
                    aId = a,
                    bId = b,
                )
            }
        }
    }

    private fun descentLinks(
        included: Included,
        unitOf: Map<String, Unit>,
        levels: Map<String, Int>,
        nodeWidth: Float,
        nodeHeight: Float,
        xOf: (Int) -> Float,
    ): List<DescentLink> = included.families.mapNotNull { (parents, children) ->
        val parentLevel = parents.firstNotNullOfOrNull { levels[it] } ?: return@mapNotNull null
        val childLevel = children.firstNotNullOfOrNull { levels[it] } ?: return@mapNotNull null
        if (childLevel != parentLevel + 1) return@mapNotNull null

        val parentAcross = parents.mapNotNull { id -> unitOf[id]?.acrossOf(id) }
        if (parentAcross.isEmpty()) return@mapNotNull null
        val originY = parentAcross.map { it + nodeHeight / 2f }.average().toFloat()

        // Kept together as pairs through the sort, so a stub and the child beside it stay matched.
        val placed = children
            .mapNotNull { id -> unitOf[id]?.acrossOf(id)?.plus(nodeHeight / 2f)?.let { id to it } }
            .sortedBy { it.second }
        if (placed.isEmpty()) return@mapNotNull null

        val parentRight = xOf(parentLevel) + nodeWidth
        val childLeft = xOf(childLevel)
        DescentLink(
            originX = parentRight,
            originY = originY,
            busX = parentRight + (childLeft - parentRight) / 2f,
            childYs = placed.map { it.second },
            childLeftX = childLeft,
            parentIds = parents.toList(),
            childIds = placed.map { it.first },
        )
    }
}
