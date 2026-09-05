package com.vibethroughcode.ftree.graph

import com.vibethroughcode.ftree.data.PartialDate
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Lays out the whole family at once.
 *
 * [TreeLayoutEngine] draws one person's neighbourhood, which is the right answer on a phone: a
 * whole family laid out at once is something no phone can show *legibly*. This draws it anyway,
 * because a chart you can pinch and pan is a different thing from a chart you must read at a
 * glance, and because it is the only view that can show the people no relationship reaches — whom
 * an ego-centric chart has nowhere to put at all.
 *
 * The method is the standard layered one, adapted for genealogy:
 *
 *  1. every person gets a generation, with spouses forced onto the same row
 *  2. each connected family is ordered within its rows to reduce crossings, couples locked together
 *  3. x comes from two opposing passes, averaged, which centres parents over children without
 *     letting rows overlap
 *  4. families are packed onto shelves that share one generation grid, so a dozen small families
 *     read as strata rather than as scattered blocks
 *
 * Pure, like the ego-centric engine: plain data in, coordinates out. No Room, no Compose, so it
 * runs off the main thread and is tested directly on the JVM.
 */
object WholeTreeLayoutEngine {

    private const val GROUP_PAD = 28f
    private const val GROUP_GAP = 56f
    private const val GUTTER = 44f
    private const val CROSSING_PASSES = 8
    private const val PLACEMENT_PASSES = 10

    private val rowPitch: Float get() = TreeMetrics.NODE_HEIGHT + TreeMetrics.LEVEL_GAP

    /** A run of spouses that must stay side by side through every pass. */
    private class Block(val members: List<String>) {
        var key = 0f
        var tie = 0
        val width: Float
            get() = members.size * TreeMetrics.NODE_WIDTH +
                (members.size - 1) * TreeMetrics.COUPLE_GAP
    }

    /**
     * @param aspect roughly how much wider than tall the finished chart should be. Below one it
     *   packs taller, which suits a phone held upright.
     */
    fun layout(snapshot: FamilySnapshot, aspect: Float = 0.9f): WholeTreeLayout {
        if (snapshot.people.isEmpty()) return WholeTreeLayout()

        val levels = assignLevels(snapshot)
        val components = components(snapshot)
        val connected = components.filter { it.size > 1 }
        val alone = components.filter { it.size == 1 }.map { it.first() }

        // Largest family first, so the trunk of the record lands top-left where reading starts.
        val laid = connected
            .map { placeComponent(snapshot, it, levels) }
            .sortedWith(compareByDescending<Placed> { it.members.size }.thenByDescending { it.width })

        val area = laid.sumOf { ((it.width + GROUP_GAP) * (it.height + GROUP_GAP)).toDouble() } +
            alone.size * (TreeMetrics.NODE_WIDTH + TreeMetrics.SIBLING_GAP).toDouble() *
            (TreeMetrics.NODE_HEIGHT + TreeMetrics.SIBLING_GAP).toDouble()
        val widest = laid.maxOfOrNull { it.width } ?: TreeMetrics.NODE_WIDTH
        val shelfWidth = max(widest, sqrt(max(area, 1.0) * aspect).toFloat())

        val nodes = mutableListOf<WholeTreeNode>()
        val groups = mutableListOf<TreeGroup>()
        val bands = mutableListOf<GenerationBand>()

        var cursorX = GUTTER
        var shelfTop = 0f
        var shelfDepth = 0
        var deepest = 0

        fun closeShelf() {
            if (shelfDepth == 0) return
            for (level in 0 until shelfDepth) {
                bands += GenerationBand(level, shelfTop + level * rowPitch, 0f, cursorX)
            }
            deepest = max(deepest, shelfDepth)
            shelfTop += shelfDepth * rowPitch + GROUP_GAP
            cursorX = GUTTER
            shelfDepth = 0
        }

        for (item in laid) {
            if (cursorX > GUTTER && cursorX + item.width > shelfWidth) closeShelf()
            val originX = cursorX
            val originY = shelfTop
            item.nodes.forEach { (id, point) ->
                val person = snapshot.people[id] ?: return@forEach
                nodes += WholeTreeNode(
                    person = person,
                    level = point.level,
                    x = point.x + originX,
                    y = point.y + originY,
                    groupIndex = groups.size,
                )
            }
            groups += TreeGroup(
                x = originX - GROUP_PAD,
                y = originY - GROUP_PAD,
                width = item.width + GROUP_PAD * 2,
                height = item.height + GROUP_PAD * 2,
                memberCount = item.members.size,
                generations = item.depth,
                unconnected = false,
                memberIds = item.members,
            )
            cursorX += item.width + GROUP_GAP
            shelfDepth = max(shelfDepth, item.depth)
        }
        closeShelf()

        /*
         * People no relationship reaches.
         *
         * The ego-centric chart cannot draw these at all — a chart of one person's relatives has
         * nowhere to put someone who is nobody's relative. A frame each would waste the screen, so
         * they go in one labelled grid: present and countable, without implying a structure the
         * record does not have. Its shape comes from its own size rather than the shelf, or a tree
         * with no connected families at all would stack them into a single column.
         */
        if (alone.isNotEmpty()) {
            val perRow = max(1, min(alone.size, ceil(sqrt(alone.size * aspect.toDouble())).toInt()))
            val originX = GUTTER
            val originY = shelfTop + GROUP_GAP
            val stepX = TreeMetrics.NODE_WIDTH + TreeMetrics.SIBLING_GAP
            val stepY = TreeMetrics.NODE_HEIGHT + TreeMetrics.SIBLING_GAP
            alone.forEachIndexed { i, id ->
                val person = snapshot.people[id] ?: return@forEachIndexed
                nodes += WholeTreeNode(
                    person = person,
                    level = -1,
                    x = originX + (i % perRow) * stepX,
                    y = originY + (i / perRow) * stepY,
                    groupIndex = groups.size,
                )
            }
            val rows = ceil(alone.size / perRow.toFloat()).toInt()
            groups += TreeGroup(
                x = originX - GROUP_PAD,
                y = originY - GROUP_PAD,
                width = min(alone.size, perRow) * stepX - TreeMetrics.SIBLING_GAP + GROUP_PAD * 2,
                height = rows * stepY - TreeMetrics.SIBLING_GAP + GROUP_PAD * 2,
                memberCount = alone.size,
                generations = 1,
                unconnected = true,
                memberIds = alone,
            )
        }

        val byId = nodes.associateBy { it.person.id }
        val links = buildLinks(snapshot, byId)

        var width = 0f
        var height = 0f
        groups.forEach {
            width = max(width, it.x + it.width)
            height = max(height, it.y + it.height)
        }

        // Shift clear of the edge so nothing touches the bezel.
        val d = TreeMetrics.MARGIN
        return WholeTreeLayout(
            nodes = nodes.map { it.copy(x = it.x + d, y = it.y + d) },
            spouseLinks = links.spouses.map { it.copy(fromX = it.fromX + d, toX = it.toX + d, y = it.y + d) },
            descentLinks = links.descents.map {
                it.copy(
                    originX = it.originX + d,
                    originY = it.originY + d,
                    busY = it.busY + d,
                    childXs = it.childXs.map { x -> x + d },
                    childTopY = it.childTopY + d,
                )
            },
            siblingBrackets = links.brackets.map {
                it.copy(fromX = it.fromX + d, toX = it.toX + d, y = it.y + d)
            },
            groups = groups.map { it.copy(x = it.x + d, y = it.y + d) },
            bands = bands.map { it.copy(x = it.x + d, y = it.y + d, width = width + d) },
            width = width + d + TreeMetrics.MARGIN,
            height = height + d + TreeMetrics.MARGIN,
            unconnectedCount = alone.size,
            generations = deepest,
        )
    }

    /* ------------------------------------------------------------------ generations */

    /**
     * Puts every person on a generation.
     *
     * A generation is a *relative* fact and nothing else: a child stands exactly one row below each
     * parent, and spouses — and siblings whose parents nobody recorded — stand on the same row as
     * each other. Those constraints are propagated outward from one seed per connected family,
     * which fixes every generation exactly, because the offset between two people is the same along
     * every route between them. [layoutComponent] then normalises each family against its own
     * topmost member.
     *
     * It is worth saying what this deliberately is *not*, because the obvious alternative is wrong
     * in a way that takes a real family to notice. Ranking people by their longest path down from
     * the oldest ancestor on record — the textbook layering — makes a person's row depend on how far
     * back their ancestry happens to be written down. A maternal grandfather whose own parents are
     * unknown lands on the top row beside a great-great-grandfather from the other side of the
     * family; worse, his three children come out on different rows from each other, because each
     * was dragged down by however deep their own spouse's ancestry ran. Generations are not depths.
     * Two people are one generation apart or they are not, and how much of the record survives
     * above them cannot change that.
     */
    private fun assignLevels(snapshot: FamilySnapshot): Map<String, Int> {
        val level = HashMap<String, Int>(snapshot.people.size)

        /*
         * Every constraint, as an offset. Derived siblings need no edge of their own — sharing a
         * parent already puts them on one row — but an explicit sibling edge exists precisely where
         * the parents are unknown, and without it those two would float apart.
         */
        fun stepsFrom(id: String): List<Pair<String, Int>> = buildList {
            snapshot.parentsOf[id].orEmpty().forEach { add(it to -1) }
            snapshot.childrenOf[id].orEmpty().forEach { add(it to 1) }
            snapshot.spousesOf[id].orEmpty().forEach { add(it to 0) }
            snapshot.siblingEdges.forEach { (a, b) ->
                if (a == id) add(b to 0) else if (b == id) add(a to 0)
            }
        }

        snapshot.people.keys.forEach { seed ->
            if (seed in level) return@forEach
            level[seed] = 0
            val queue = ArrayDeque(listOf(seed))
            while (queue.isNotEmpty()) {
                val current = queue.removeFirst()
                val base = level.getValue(current)
                stepsFrom(current).forEach { (next, delta) ->
                    if (next !in snapshot.people || next in level) return@forEach
                    level[next] = base + delta
                    queue.addLast(next)
                }
            }
        }

        /*
         * The constraints can only disagree when the record itself does — somebody married to their
         * own aunt gives one route saying "same row" and another saying "one row apart", and no
         * assignment satisfies both. Where that happens the parent edge wins, because a connector
         * running upward out of a child into their parent is unreadable in a way that a couple
         * sitting a row apart is not. Bounded, so a cycle in an imported file still draws rather
         * than hanging.
         */
        repeat(40) {
            var changed = false
            snapshot.parentEdges.forEach { (from, to) ->
                val above = level[from] ?: return@forEach
                val below = level[to] ?: return@forEach
                if (below <= above) {
                    level[to] = above + 1
                    changed = true
                }
            }
            if (!changed) return@repeat
        }

        return level
    }

    /** Connected families, over every edge kind, so nobody is dropped for being unconnected. */
    private fun components(snapshot: FamilySnapshot): List<List<String>> {
        val adjacency = mutableMapOf<String, MutableList<String>>()
        fun link(a: String, b: String) {
            if (a !in snapshot.people || b !in snapshot.people) return
            adjacency.getOrPut(a) { mutableListOf() } += b
            adjacency.getOrPut(b) { mutableListOf() } += a
        }
        snapshot.parentEdges.forEach { (a, b) -> link(a, b) }
        snapshot.spouseEdges.forEach { (a, b) -> link(a, b) }
        snapshot.siblingEdges.forEach { (a, b) -> link(a, b) }

        val seen = mutableSetOf<String>()
        val out = mutableListOf<List<String>>()
        snapshot.people.keys.forEach { start ->
            if (!seen.add(start)) return@forEach
            val members = mutableListOf<String>()
            val stack = ArrayDeque(listOf(start))
            while (stack.isNotEmpty()) {
                val current = stack.removeLast()
                members += current
                adjacency[current]?.forEach { if (seen.add(it)) stack.addLast(it) }
            }
            out += members
        }
        return out
    }

    /* ------------------------------------------------------------------ one family */

    private class Point(val level: Int, val x: Float, val y: Float)

    private class Placed(
        val members: List<String>,
        val nodes: Map<String, Point>,
        val width: Float,
        val height: Float,
        val depth: Int,
    )

    private fun placeComponent(
        snapshot: FamilySnapshot,
        members: List<String>,
        globalLevels: Map<String, Int>,
    ): Placed {
        val base = members.minOf { globalLevels.getValue(it) }
        val levels = members.associateWith { globalLevels.getValue(it) - base }

        val rows = initialOrder(snapshot, members, levels)
        reduceCrossings(snapshot, rows)
        val xs = assignX(snapshot, rows)

        val minX = members.minOf { xs.getValue(it) }
        val maxX = members.maxOf { xs.getValue(it) } + TreeMetrics.NODE_WIDTH
        val depth = members.maxOf { levels.getValue(it) } + 1

        return Placed(
            members = members,
            nodes = members.associateWith {
                Point(levels.getValue(it), xs.getValue(it) - minX, levels.getValue(it) * rowPitch)
            },
            width = maxX - minX,
            height = depth * rowPitch - TreeMetrics.LEVEL_GAP,
            depth = depth,
        )
    }

    private fun birthOrder(snapshot: FamilySnapshot): Comparator<String> = Comparator { a, b ->
        val pa = snapshot.people[a]
        val pb = snapshot.people[b]
        val ya = PartialDate.parse(pa?.birthDate)?.year
        val yb = PartialDate.parse(pb?.birthDate)?.year
        when {
            ya != null && yb != null && ya != yb -> ya - yb
            ya != null && yb == null -> -1
            ya == null && yb != null -> 1
            else -> (pa?.name ?: "￿").compareTo(pb?.name ?: "￿")
        }
    }

    /**
     * A first ordering, walked family by family: spouses beside each other, then down through each
     * family's children in birth order. This alone lays out a tree-shaped family correctly, so the
     * sweeps that follow only have to fix the places where it is not a tree.
     */
    private fun initialOrder(
        snapshot: FamilySnapshot,
        members: List<String>,
        levels: Map<String, Int>,
    ): MutableMap<Int, MutableList<String>> {
        val rows = mutableMapOf<Int, MutableList<String>>()
        val seen = mutableSetOf<String>()
        val compare = birthOrder(snapshot)
        val explicitSiblings = snapshot.siblingEdges
            .flatMap { listOf(it.first to it.second, it.second to it.first) }
            .groupBy({ it.first }, { it.second })

        fun place(id: String): Boolean {
            if (!seen.add(id)) return false
            rows.getOrPut(levels.getValue(id)) { mutableListOf() } += id
            return true
        }

        fun visit(id: String) {
            if (!place(id)) return
            val spouses = snapshot.spousesOf[id].orEmpty().filter { it in levels && it !in seen }
            spouses.forEach { place(it) }

            // A sibling recorded as an explicit edge has no shared parent to hang from, so nothing
            // else in the layout would ever pull the two together. Seat them here.
            explicitSiblings[id].orEmpty().forEach { if (it in levels) visit(it) }

            // Grouped by parent *set*, which is what puts a couple's children on one bar and hangs
            // a half-sibling from their own.
            val families = linkedSetOf<List<String>>()
            (listOf(id) + spouses).forEach { holder ->
                snapshot.childrenOf[holder].orEmpty().forEach { child ->
                    if (child in levels) families += snapshot.parentsOf[child].orEmpty().sorted()
                }
            }
            families.forEach { parentSet ->
                val children = parentSet.flatMap { snapshot.childrenOf[it].orEmpty() }
                    .distinct()
                    .filter { it in levels && snapshot.parentsOf[it].orEmpty().sorted() == parentSet }
                children.sortedWith(compare).forEach { visit(it) }
            }
        }

        // Shallowest and most connected first, so the trunk is laid down before the offcuts.
        val roots = members.sortedWith(
            compareBy<String> { levels.getValue(it) }
                .thenByDescending { snapshot.childrenOf[it].orEmpty().size }
        )
        roots.forEach { visit(it) }
        roots.forEach { place(it) }
        return rows
    }

    private fun buildBlocks(snapshot: FamilySnapshot, row: List<String>): List<Block> {
        val present = row.toSet()
        val taken = mutableSetOf<String>()
        val blocks = mutableListOf<Block>()

        row.forEach { id ->
            if (id in taken) return@forEach
            val group = mutableListOf(id)
            taken += id
            var i = 0
            while (i < group.size) {
                snapshot.spousesOf[group[i]].orEmpty().forEach { s ->
                    if (s in present && taken.add(s)) group += s
                }
                i++
            }

            if (group.size <= 2) {
                blocks += Block(group)
                return@forEach
            }
            /*
             * Somebody married twice goes *between* their partners. Ordered any other way the two
             * partners sit side by side at couple spacing, and the chart states they were married
             * to each other: the spacing is the notation, so getting it wrong asserts a falsehood.
             */
            val hub = group.maxBy { m -> snapshot.spousesOf[m].orEmpty().count { it in group } }
            val partners = group.filter { it != hub }.sortedWith(birthOrder(snapshot))
            val half = (partners.size + 1) / 2
            blocks += Block(partners.take(half) + hub + partners.drop(half))
        }
        return blocks
    }

    /**
     * Barycentre sweeps: each block moves to the average position of what it connects to on the
     * neighbouring row. Alternating direction a few times settles the ordering.
     */
    private fun reduceCrossings(
        snapshot: FamilySnapshot,
        rows: MutableMap<Int, MutableList<String>>,
    ) {
        val keys = rows.keys.sorted()
        if (keys.size < 2) return

        repeat(CROSSING_PASSES) { pass ->
            val downward = pass % 2 == 0
            val order = if (downward) keys else keys.reversed()

            order.forEach { level ->
                val neighbourRow = rows[level + if (downward) -1 else 1] ?: return@forEach
                val positions = neighbourRow.withIndex().associate { (i, id) -> id to i }
                val row = rows.getValue(level)
                val current = row.withIndex().associate { (i, id) -> id to i }
                val blocks = buildBlocks(snapshot, row)

                blocks.forEach { block ->
                    val seen = block.members.flatMap { id ->
                        val related = if (downward) snapshot.parentsOf[id].orEmpty()
                        else snapshot.childrenOf[id].orEmpty()
                        related.mapNotNull { positions[it] }
                    }
                    // A block with nothing on the neighbouring row keeps its place rather than
                    // drifting to the start of the row.
                    block.key = if (seen.isNotEmpty()) {
                        seen.sum().toFloat() / seen.size
                    } else {
                        current.getValue(block.members.first()).toFloat() *
                            (positions.size.toFloat() / max(1, row.size))
                    }
                    block.tie = current.getValue(block.members.first())
                }

                blocks.sortedWith(compareBy({ it.key }, { it.tie }))
                    .flatMap { it.members }
                    .let { rows[level] = it.toMutableList() }
            }
        }
    }

    /**
     * Places one row, pulling each block toward where it wants to be without letting blocks
     * overlap. Run from both ends and averaged: a single left-to-right pass jams everything against
     * the left whenever a row is crowded.
     */
    private fun placeRow(blocks: List<Block>, desired: Map<Block, Float>): FloatArray {
        val gap = TreeMetrics.SIBLING_GAP
        val left = FloatArray(blocks.size)
        var cursor = Float.NEGATIVE_INFINITY
        blocks.forEachIndexed { i, block ->
            val packed = if (cursor.isFinite()) cursor else 0f
            val want = desired[block]?.minus(block.width / 2f) ?: packed
            left[i] = max(want, cursor)
            cursor = left[i] + block.width + gap
        }

        /*
         * A block with nothing pulling on it must nestle against its neighbour rather than keep
         * whatever coordinate it happens to hold: treating its own position as its wish makes the
         * placement a ratchet that can only move right, stranding anyone childless at the edge.
         */
        val right = FloatArray(blocks.size)
        cursor = left[blocks.size - 1] + blocks[blocks.size - 1].width
        for (i in blocks.indices.reversed()) {
            val packed = cursor - blocks[i].width
            val want = desired[blocks[i]]?.minus(blocks[i].width / 2f) ?: packed
            right[i] = min(want, packed)
            cursor = right[i] - gap
        }

        // Averaging two feasible placements can breach the minimum gap, so restore it once.
        val out = FloatArray(blocks.size) { (left[it] + right[it]) / 2f }
        cursor = Float.NEGATIVE_INFINITY
        for (i in blocks.indices) {
            out[i] = max(out[i], cursor)
            cursor = out[i] + blocks[i].width + gap
        }
        return out
    }

    private fun assignX(
        snapshot: FamilySnapshot,
        rows: Map<Int, MutableList<String>>,
    ): Map<String, Float> {
        val keys = rows.keys.sorted()
        val x = mutableMapOf<String, Float>()
        val blocksByLevel = mutableMapOf<Int, List<Block>>()

        keys.forEach { level ->
            val blocks = buildBlocks(snapshot, rows.getValue(level))
            blocksByLevel[level] = blocks
            var cursor = 0f
            blocks.forEach { block ->
                var bx = cursor
                block.members.forEach { id ->
                    x[id] = bx
                    bx += TreeMetrics.NODE_WIDTH + TreeMetrics.COUPLE_GAP
                }
                cursor += block.width + TreeMetrics.SIBLING_GAP
            }
        }

        val rowSets = keys.associateWith { rows.getValue(it).toSet() }

        repeat(PLACEMENT_PASSES) { pass ->
            val upward = pass % 2 == 0
            val order = if (upward) keys.reversed() else keys

            order.forEach { level ->
                val blocks = blocksByLevel.getValue(level)
                val neighbours = rowSets[level + if (upward) 1 else -1]
                val desired = mutableMapOf<Block, Float>()

                blocks.forEach { block ->
                    val targets = block.members.flatMap { id ->
                        // Going up a parent wants to sit over the middle of their children; going
                        // down a child wants to sit under the middle of their parents.
                        val related = if (upward) snapshot.childrenOf[id].orEmpty()
                        else snapshot.parentsOf[id].orEmpty()
                        related.mapNotNull { other ->
                            if (neighbours?.contains(other) == true) {
                                x[other]?.plus(TreeMetrics.NODE_WIDTH / 2f)
                            } else null
                        }
                    }
                    // A block with no relatives on the neighbouring row states no wish at all;
                    // placeRow packs it against its neighbours instead.
                    if (targets.isNotEmpty()) desired[block] = targets.sum() / targets.size
                }

                val placed = placeRow(blocks, desired)
                blocks.forEachIndexed { i, block ->
                    var bx = placed[i]
                    block.members.forEach { id ->
                        x[id] = bx
                        bx += TreeMetrics.NODE_WIDTH + TreeMetrics.COUPLE_GAP
                    }
                }
            }
        }

        return x
    }

    /* ------------------------------------------------------------------ connectors */

    private class Links(
        val spouses: List<WholeSpouseLink>,
        val descents: List<DescentLink>,
        val brackets: List<SiblingBracket>,
    )

    private fun buildLinks(
        snapshot: FamilySnapshot,
        byId: Map<String, WholeTreeNode>,
    ): Links {
        val spouses = mutableListOf<WholeSpouseLink>()
        snapshot.spouseEdges.forEach { (a, b) ->
            val na = byId[a] ?: return@forEach
            val nb = byId[b] ?: return@forEach
            if (na.y != nb.y) return@forEach
            val left = if (na.x < nb.x) na else nb
            val right = if (na.x < nb.x) nb else na
            // Drawn only when they are actually adjacent; a rule spanning three cards would read as
            // a marriage to whoever sits in between.
            if (right.x - (left.x + TreeMetrics.NODE_WIDTH) > TreeMetrics.SIBLING_GAP) return@forEach
            spouses += WholeSpouseLink(
                fromX = left.x + TreeMetrics.NODE_WIDTH,
                toX = right.x,
                y = left.centerY,
                ended = false,
            )
        }

        // One descent per parent *set*, which is what puts a couple's children on a single bar and
        // hangs a half-sibling from their own.
        val descents = mutableListOf<DescentLink>()
        snapshot.people.keys
            .mapNotNull { child ->
                val parents = snapshot.parentsOf[child].orEmpty().sorted()
                if (parents.isEmpty()) null else parents to child
            }
            .groupBy({ it.first }, { it.second })
            .forEach { (parentIds, childIds) ->
                val parentNodes = parentIds.mapNotNull { byId[it] }
                val childNodes = childIds.mapNotNull { byId[it] }.sortedBy { it.x }
                if (parentNodes.isEmpty() || childNodes.isEmpty()) return@forEach

                val originY = parentNodes.maxOf { it.bottom }
                val childTopY = childNodes.minOf { it.y }
                descents += DescentLink(
                    originX = parentNodes.map { it.centerX }.average().toFloat(),
                    originY = originY,
                    // Just above the shallowest child, so a child placed further down gets a longer
                    // drop rather than dragging the whole bar out of place.
                    busY = max(childTopY - TreeMetrics.LEVEL_GAP * 0.42f, originY + 10f),
                    childXs = childNodes.map { it.centerX },
                    childTopY = childTopY,
                )
            }

        val brackets = mutableListOf<SiblingBracket>()
        snapshot.siblingEdges.forEach { (a, b) ->
            val na = byId[a] ?: return@forEach
            val nb = byId[b] ?: return@forEach
            if (na.y != nb.y) return@forEach
            val left = if (na.x < nb.x) na else nb
            val right = if (na.x < nb.x) nb else na
            brackets += SiblingBracket(left.centerX, right.centerX, left.y)
        }

        return Links(spouses, descents, brackets)
    }
}
