package com.vibethroughcode.ftree.graph

import com.vibethroughcode.ftree.data.PartialDate
import com.vibethroughcode.ftree.data.Person
import kotlin.math.max

/**
 * Arranges a slice of the family graph into a readable genealogical chart.
 *
 * The chart is ego-centric on purpose. Laying out an entire family produces something no phone can
 * show and no person can read, so this draws one person's ancestors above and descendants below,
 * with their siblings beside them, and everyone else is reached by re-focusing. That also keeps the
 * work proportional to what is on screen rather than to the size of the tree.
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
     * descend from.
     */
    private class Unit(val members: List<String>) {
        var x = 0f
        val width: Float
            get() = members.size * TreeMetrics.NODE_WIDTH +
                (members.size - 1) * TreeMetrics.COUPLE_GAP

        fun xOf(personId: String): Float =
            x + members.indexOf(personId) * (TreeMetrics.NODE_WIDTH + TreeMetrics.COUPLE_GAP)

        val centerX: Float get() = x + width / 2f
    }

    fun layout(
        snapshot: FamilySnapshot,
        focusId: String,
        generationsUp: Int = 3,
        generationsDown: Int = 3,
    ): TreeLayout {
        if (focusId !in snapshot.people) return TreeLayout()

        val included = collect(snapshot, focusId, generationsUp, generationsDown)
        val levels = included.levels

        // --- Build the units, one per person-and-partners group, per level. ---
        val unitOf = mutableMapOf<String, Unit>()
        val unitsByLevel = mutableMapOf<Int, MutableList<Unit>>()
        levels.entries.groupBy({ it.value }, { it.key }).forEach { (level, ids) ->
            buildUnits(ids.toSet(), snapshot).forEach { unit ->
                unit.members.forEach { unitOf[it] = unit }
                unitsByLevel.getOrPut(level) { mutableListOf() } += unit
            }
        }

        val focusUnit = unitOf[focusId] ?: return TreeLayout()

        // --- Level 0: the focus and their siblings, in birth order. ---
        val row0 = unitsByLevel[0] ?: mutableListOf()
        orderByBirth(row0, snapshot)

        // Siblings sit directly beside the focus. Their own descendants are not drawn (see
        // `collect`), so the focus's subtree can spread out on the rows below without ever
        // colliding with them — reserving the subtree's whole width up here would only shove the
        // siblings, and the ancestors centred above them, far off to one side.
        var cursor = 0f
        row0.forEach { unit ->
            unit.x = cursor
            cursor += unit.width + TreeMetrics.SIBLING_GAP
        }

        placeDescendants(focusUnit, unitOf, unitsByLevel, snapshot, included)
        placeAncestors(row0, unitOf, unitsByLevel, snapshot, included)

        // --- Normalise so the chart starts at the margin. ---
        val allUnits = unitsByLevel.values.flatten()
        val minX = allUnits.minOfOrNull { it.x } ?: 0f
        val minLevel = levels.values.minOrNull() ?: 0
        allUnits.forEach { it.x += TreeMetrics.MARGIN - minX }

        fun yOf(level: Int) = TreeMetrics.MARGIN + (level - minLevel) * TreeMetrics.ROW_HEIGHT

        val nodes = levels.mapNotNull { (id, level) ->
            val person = snapshot.people[id] ?: return@mapNotNull null
            TreeNode(
                person = person,
                level = level,
                x = unitOf.getValue(id).xOf(id),
                y = yOf(level),
                isFocus = id == focusId,
            )
        }.sortedBy { it.level }

        return TreeLayout(
            nodes = nodes,
            spouseLinks = spouseLinks(unitsByLevel, ::yOf),
            descentLinks = descentLinks(included, unitOf, levels, ::yOf),
            width = (allUnits.maxOfOrNull { it.x + it.width } ?: 0f) + TreeMetrics.MARGIN,
            height = yOf(levels.values.maxOrNull() ?: 0) +
                TreeMetrics.NODE_HEIGHT + TreeMetrics.MARGIN,
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

    private fun buildUnits(ids: Set<String>, snapshot: FamilySnapshot): List<Unit> {
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
            // has a spouse on each side rather than both crowded to one.
            val ordered = group.sortedByDescending { snapshot.spousesOf[it].orEmpty().count { s -> s in group } }
            val members = when (ordered.size) {
                1, 2 -> ordered
                else -> {
                    val hub = ordered.first()
                    val rest = ordered.drop(1)
                    rest.take(rest.size / 2) + hub + rest.drop(rest.size / 2)
                }
            }
            units += Unit(members)
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

    /** Width the focus's descendants will need, before anything is positioned. */
    private fun measureDescendants(
        unit: Unit,
        unitOf: Map<String, Unit>,
        unitsByLevel: Map<Int, List<Unit>>,
        snapshot: FamilySnapshot,
        included: Included,
    ): Float {
        val children = childUnitsOf(unit, unitOf, snapshot, included)
        if (children.isEmpty()) return unit.width
        val childrenWidth = children.sumOf {
            measureDescendants(it, unitOf, unitsByLevel, snapshot, included).toDouble()
        }.toFloat() + (children.size - 1) * TreeMetrics.SIBLING_GAP
        return max(unit.width, childrenWidth)
    }

    /** Packs each generation of children beneath and centred on their parents. */
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

        val widths = children.map {
            measureDescendants(it, unitOf, unitsByLevel, snapshot, included)
        }
        val total = widths.sum() + (children.size - 1) * TreeMetrics.SIBLING_GAP
        var cursor = unit.centerX - total / 2f

        children.forEachIndexed { index, child ->
            child.x = cursor + (widths[index] - child.width) / 2f
            cursor += widths[index] + TreeMetrics.SIBLING_GAP
            placeDescendants(child, unitOf, unitsByLevel, snapshot, included)
        }
    }

    /**
     * Places each generation of parents above and centred on their children, then pushes apart any
     * that collide. Ancestors fan out faster than descendants, so the separation sweep matters more
     * here than the centring does.
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
                unit.x = if (theirChildren.isEmpty()) {
                    childRow.firstOrNull()?.centerX?.minus(unit.width / 2f) ?: 0f
                } else {
                    theirChildren.map { it.centerX }.average().toFloat() - unit.width / 2f
                }
            }

            separate(row)
            childRow = row
        }
    }

    /** Sweeps a row left to right, shifting anything that overlaps its neighbour. */
    private fun separate(row: List<Unit>) {
        val sorted = row.sortedBy { it.x }
        for (i in 1 until sorted.size) {
            val previous = sorted[i - 1]
            val minimum = previous.x + previous.width + TreeMetrics.SIBLING_GAP
            if (sorted[i].x < minimum) sorted[i].x = minimum
        }
    }

    // ------------------------------------------------------------------ connectors

    private fun spouseLinks(
        unitsByLevel: Map<Int, List<Unit>>,
        yOf: (Int) -> Float,
    ): List<SpouseLink> = unitsByLevel.flatMap { (level, units) ->
        units.flatMap { unit ->
            unit.members.zipWithNext { a, b ->
                SpouseLink(
                    fromX = unit.xOf(a) + TreeMetrics.NODE_WIDTH,
                    toX = unit.xOf(b),
                    y = yOf(level) + TreeMetrics.NODE_HEIGHT / 2f,
                )
            }
        }
    }

    private fun descentLinks(
        included: Included,
        unitOf: Map<String, Unit>,
        levels: Map<String, Int>,
        yOf: (Int) -> Float,
    ): List<DescentLink> = included.families.mapNotNull { (parents, children) ->
        val parentLevel = parents.firstNotNullOfOrNull { levels[it] } ?: return@mapNotNull null
        val childLevel = children.firstNotNullOfOrNull { levels[it] } ?: return@mapNotNull null
        if (childLevel != parentLevel + 1) return@mapNotNull null

        val parentXs = parents.mapNotNull { id -> unitOf[id]?.xOf(id) }
        if (parentXs.isEmpty()) return@mapNotNull null
        val originX = parentXs.map { it + TreeMetrics.NODE_WIDTH / 2f }.average().toFloat()

        val childXs = children
            .mapNotNull { id -> unitOf[id]?.xOf(id)?.plus(TreeMetrics.NODE_WIDTH / 2f) }
            .sorted()
        if (childXs.isEmpty()) return@mapNotNull null

        val parentBottom = yOf(parentLevel) + TreeMetrics.NODE_HEIGHT
        val childTop = yOf(childLevel)
        DescentLink(
            originX = originX,
            originY = parentBottom,
            busY = parentBottom + (childTop - parentBottom) / 2f,
            childXs = childXs,
            childTopY = childTop,
        )
    }
}
