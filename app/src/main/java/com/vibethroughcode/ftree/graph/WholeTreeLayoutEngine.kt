package com.vibethroughcode.ftree.graph

import com.vibethroughcode.ftree.data.PartialDate
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Lays out the whole family at once, sideways.
 *
 * [TreeLayoutEngine] draws one person's neighbourhood, which is the right answer on a phone: a
 * whole family laid out at once is something no phone can show *legibly*. This draws it anyway,
 * because a chart you can pinch and pan is a different thing from a chart you must read at a
 * glance, and because it is the only view that can show the people no relationship reaches — whom
 * an ego-centric chart has nowhere to put at all.
 *
 * **A generation is a column, not a row.** See [WholeTreeLayout] for why: laid out the ordinary way
 * round, a real record is a ribbon fifteen times wider than it is tall, and no packing improves it
 * because the width is the widest generation and nothing else. Turning the chart through a right
 * angle is the only thing that changes the shape, and it turns the long axis into the one a phone
 * scrolls.
 *
 * The method is the standard layered one, adapted for genealogy, and is unchanged by the rotation —
 * only which axis carries which meaning:
 *
 *  1. every person gets a generation, with spouses forced into the same column
 *  2. each connected family is ordered within its columns to reduce crossings, couples locked
 *     together
 *  3. position within a column comes from two opposing passes, averaged, which centres parents
 *     beside their children without letting columns overlap
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

    /** One generation to the next, along the reading axis. */
    private val generationPitch: Float
        get() = TreeMetrics.NODE_WIDTH + TreeMetrics.GENERATION_GAP

    /** How much room one person takes within their generation. */
    private val personExtent: Float get() = TreeMetrics.NODE_HEIGHT

    /** A run of spouses that must stay together through every pass. */
    private class Block(val members: List<String>) {
        var key = 0f
        var tie = 0

        /** How far the block reaches along its own generation. */
        val extent: Float
            get() = members.size * TreeMetrics.NODE_HEIGHT +
                (members.size - 1) * TreeMetrics.COUPLE_GAP
    }

    /**
     * @param aspect roughly how much wider than tall the finished chart should be. Below one it
     *   packs taller, which is what a phone wants — and what the rotation exists to achieve, so the
     *   default is well below one rather than close to it.
     */
    fun layout(snapshot: FamilySnapshot, aspect: Float = 0.45f): WholeTreeLayout {
        if (snapshot.people.isEmpty()) return WholeTreeLayout()

        val levels = assignLevels(snapshot)
        val components = components(snapshot)
        val connected = components.filter { it.size > 1 }
        val alone = components.filter { it.size == 1 }.map { it.first() }

        // Largest family first, so the trunk of the record lands top-left where reading starts.
        val laid = connected
            .map { placeComponent(snapshot, it, levels) }
            .sortedWith(compareByDescending<Placed> { it.members.size }.thenByDescending { it.extent })

        val area = laid.sumOf { ((it.span + GROUP_GAP) * (it.extent + GROUP_GAP)).toDouble() } +
            alone.size * (TreeMetrics.NODE_WIDTH + TreeMetrics.SIBLING_GAP).toDouble() *
            (TreeMetrics.NODE_HEIGHT + TreeMetrics.STACK_GAP).toDouble()
        val tallest = laid.maxOfOrNull { it.extent } ?: TreeMetrics.NODE_HEIGHT
        // Divided by the aspect rather than multiplied: the shelf now grows down the screen, so
        // wanting a taller chart means wanting a taller shelf.
        val shelfHeight = max(tallest, sqrt(max(area, 1.0) / aspect).toFloat())

        val nodes = mutableListOf<WholeTreeNode>()
        val groups = mutableListOf<TreeGroup>()
        val bands = mutableListOf<GenerationBand>()

        var cursorY = GUTTER
        var shelfLeft = 0f
        var shelfDepth = 0
        var deepest = 0

        fun closeShelf() {
            if (shelfDepth == 0) return
            for (level in 0 until shelfDepth) {
                bands += GenerationBand(level, shelfLeft + level * generationPitch, 0f, cursorY)
            }
            deepest = max(deepest, shelfDepth)
            shelfLeft += shelfDepth * generationPitch + GROUP_GAP
            cursorY = GUTTER
            shelfDepth = 0
        }

        for (item in laid) {
            if (cursorY > GUTTER && cursorY + item.extent > shelfHeight) closeShelf()
            val originX = shelfLeft
            val originY = cursorY
            item.nodes.forEach { (id, point) ->
                val person = snapshot.people[id] ?: return@forEach
                nodes += WholeTreeNode(
                    person = person,
                    level = point.level,
                    x = point.level * generationPitch + originX,
                    y = point.across + originY,
                    groupIndex = groups.size,
                )
            }
            groups += TreeGroup(
                x = originX - GROUP_PAD,
                y = originY - GROUP_PAD,
                width = item.span + GROUP_PAD * 2,
                height = item.extent + GROUP_PAD * 2,
                memberCount = item.members.size,
                generations = item.depth,
                unconnected = false,
                memberIds = item.members,
            )
            cursorY += item.extent + GROUP_GAP
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
         * with no connected families at all would stack them into a single row.
         */
        if (alone.isNotEmpty()) {
            val perColumn = max(1, min(alone.size, ceil(sqrt(alone.size / aspect.toDouble())).toInt()))
            val originX = shelfLeft + GROUP_GAP
            val originY = GUTTER
            val stepX = TreeMetrics.NODE_WIDTH + TreeMetrics.SIBLING_GAP
            val stepY = TreeMetrics.NODE_HEIGHT + TreeMetrics.STACK_GAP
            alone.forEachIndexed { i, id ->
                val person = snapshot.people[id] ?: return@forEachIndexed
                nodes += WholeTreeNode(
                    person = person,
                    level = -1,
                    x = originX + (i / perColumn) * stepX,
                    y = originY + (i % perColumn) * stepY,
                    groupIndex = groups.size,
                )
            }
            val columns = ceil(alone.size / perColumn.toFloat()).toInt()
            groups += TreeGroup(
                x = originX - GROUP_PAD,
                y = originY - GROUP_PAD,
                width = columns * stepX - TreeMetrics.SIBLING_GAP + GROUP_PAD * 2,
                height = min(alone.size, perColumn) * stepY - TreeMetrics.STACK_GAP + GROUP_PAD * 2,
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
            spouseLinks = links.spouses.map {
                it.copy(x = it.x + d, fromY = it.fromY + d, toY = it.toY + d)
            },
            descentLinks = links.descents.map {
                it.copy(
                    originX = it.originX + d,
                    originY = it.originY + d,
                    busX = it.busX + d,
                    childYs = it.childYs.map { y -> y + d },
                    childLeftX = it.childLeftX + d,
                )
            },
            siblingBrackets = links.brackets.map {
                it.copy(fromY = it.fromY + d, toY = it.toY + d, x = it.x + d)
            },
            groups = groups.map { it.copy(x = it.x + d, y = it.y + d) },
            bands = bands.map { it.copy(x = it.x + d, y = it.y + d, height = height + d) },
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
     * A generation is a *relative* fact and nothing else: a child stands exactly one column after
     * each parent, and spouses — and siblings whose parents nobody recorded — stand in the same
     * column as each other. Those constraints are propagated outward from one seed per connected
     * family, which fixes every generation exactly, because the offset between two people is the
     * same along every route between them. [placeComponent] then normalises each family against its
     * own earliest member.
     *
     * It is worth saying what this deliberately is *not*, because the obvious alternative is wrong
     * in a way that takes a real family to notice. Ranking people by their longest path down from
     * the oldest ancestor on record — the textbook layering — makes a person's column depend on how
     * far back their ancestry happens to be written down. A maternal grandfather whose own parents
     * are unknown lands in the first column beside a great-great-grandfather from the other side of
     * the family; worse, his three children come out in different columns from each other, because
     * each was dragged along by however deep their own spouse's ancestry ran. Generations are not
     * depths. Two people are one generation apart or they are not, and how much of the record
     * survives above them cannot change that.
     */
    private fun assignLevels(snapshot: FamilySnapshot): Map<String, Int> {
        val level = HashMap<String, Int>(snapshot.people.size)

        /*
         * Every constraint, as an offset. Derived siblings need no edge of their own — sharing a
         * parent already puts them in one column — but an explicit sibling edge exists precisely
         * where the parents are unknown, and without it those two would float apart.
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
         * own aunt gives one route saying "same column" and another saying "one column apart", and
         * no assignment satisfies both. Where that happens the parent edge wins, because a
         * connector running backwards out of a child into their parent is unreadable in a way that
         * a couple sitting a column apart is not. Bounded, so a cycle in an imported file still
         * draws rather than hanging.
         */
        repeat(40) {
            var changed = false
            snapshot.parentEdges.forEach { (from, to) ->
                val before = level[from] ?: return@forEach
                val after = level[to] ?: return@forEach
                if (after <= before) {
                    level[to] = before + 1
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

    private class Point(val level: Int, val across: Float)

    private class Placed(
        val members: List<String>,
        val nodes: Map<String, Point>,
        /** How far the family reaches along a generation. */
        val extent: Float,
        /** How far it reaches across the generations. */
        val span: Float,
        val depth: Int,
    )

    private fun placeComponent(
        snapshot: FamilySnapshot,
        members: List<String>,
        globalLevels: Map<String, Int>,
    ): Placed {
        val base = members.minOf { globalLevels.getValue(it) }
        val levels = members.associateWith { globalLevels.getValue(it) - base }

        val columns = initialOrder(snapshot, members, levels)
        reduceCrossings(snapshot, columns)
        val across = assignAcross(snapshot, columns)

        val minAcross = members.minOf { across.getValue(it) }
        val maxAcross = members.maxOf { across.getValue(it) } + personExtent
        val depth = members.maxOf { levels.getValue(it) } + 1

        return Placed(
            members = members,
            nodes = members.associateWith {
                Point(levels.getValue(it), across.getValue(it) - minAcross)
            },
            extent = maxAcross - minAcross,
            span = depth * generationPitch - TreeMetrics.GENERATION_GAP,
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
     * A first ordering, walked family by family: spouses beside each other, then along each
     * family's children in birth order. This alone lays out a tree-shaped family correctly, so the
     * sweeps that follow only have to fix the places where it is not a tree.
     */
    private fun initialOrder(
        snapshot: FamilySnapshot,
        members: List<String>,
        levels: Map<String, Int>,
    ): MutableMap<Int, MutableList<String>> {
        val columns = mutableMapOf<Int, MutableList<String>>()
        val seen = mutableSetOf<String>()
        val compare = birthOrder(snapshot)
        val explicitSiblings = snapshot.siblingEdges
            .flatMap { listOf(it.first to it.second, it.second to it.first) }
            .groupBy({ it.first }, { it.second })

        fun place(id: String): Boolean {
            if (!seen.add(id)) return false
            columns.getOrPut(levels.getValue(id)) { mutableListOf() } += id
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
        return columns
    }

    private fun buildBlocks(snapshot: FamilySnapshot, column: List<String>): List<Block> {
        val present = column.toSet()
        val taken = mutableSetOf<String>()
        val blocks = mutableListOf<Block>()

        column.forEach { id ->
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
     * Barycentre sweeps: each block moves to the average position of what it connects to in the
     * neighbouring column. Alternating direction a few times settles the ordering.
     */
    private fun reduceCrossings(
        snapshot: FamilySnapshot,
        columns: MutableMap<Int, MutableList<String>>,
    ) {
        val keys = columns.keys.sorted()
        if (keys.size < 2) return

        repeat(CROSSING_PASSES) { pass ->
            val forward = pass % 2 == 0
            val order = if (forward) keys else keys.reversed()

            order.forEach { level ->
                val neighbour = columns[level + if (forward) -1 else 1] ?: return@forEach
                val positions = neighbour.withIndex().associate { (i, id) -> id to i }
                val column = columns.getValue(level)
                val current = column.withIndex().associate { (i, id) -> id to i }
                val blocks = buildBlocks(snapshot, column)

                blocks.forEach { block ->
                    val seen = block.members.flatMap { id ->
                        val related = if (forward) snapshot.parentsOf[id].orEmpty()
                        else snapshot.childrenOf[id].orEmpty()
                        related.mapNotNull { positions[it] }
                    }
                    // A block with nothing in the neighbouring column keeps its place rather than
                    // drifting to the start of it.
                    block.key = if (seen.isNotEmpty()) {
                        seen.sum().toFloat() / seen.size
                    } else {
                        current.getValue(block.members.first()).toFloat() *
                            (positions.size.toFloat() / max(1, column.size))
                    }
                    block.tie = current.getValue(block.members.first())
                }

                blocks.sortedWith(compareBy({ it.key }, { it.tie }))
                    .flatMap { it.members }
                    .let { columns[level] = it.toMutableList() }
            }
        }
    }

    /**
     * Places one column, pulling each block toward where it wants to be without letting blocks
     * overlap. Run from both ends and averaged: a single pass jams everything against the top
     * whenever a column is crowded.
     */
    private fun placeColumn(blocks: List<Block>, desired: Map<Block, Float>): FloatArray {
        val gap = TreeMetrics.STACK_GAP
        val near = FloatArray(blocks.size)
        var cursor = Float.NEGATIVE_INFINITY
        blocks.forEachIndexed { i, block ->
            val packed = if (cursor.isFinite()) cursor else 0f
            val want = desired[block]?.minus(block.extent / 2f) ?: packed
            near[i] = max(want, cursor)
            cursor = near[i] + block.extent + gap
        }

        /*
         * A block with nothing pulling on it must nestle against its neighbour rather than keep
         * whatever coordinate it happens to hold: treating its own position as its wish makes the
         * placement a ratchet that can only move one way, stranding anyone childless at the edge.
         */
        val far = FloatArray(blocks.size)
        cursor = near[blocks.size - 1] + blocks[blocks.size - 1].extent
        for (i in blocks.indices.reversed()) {
            val packed = cursor - blocks[i].extent
            val want = desired[blocks[i]]?.minus(blocks[i].extent / 2f) ?: packed
            far[i] = min(want, packed)
            cursor = far[i] - gap
        }

        // Averaging two feasible placements can breach the minimum gap, so restore it once.
        val out = FloatArray(blocks.size) { (near[it] + far[it]) / 2f }
        cursor = Float.NEGATIVE_INFINITY
        for (i in blocks.indices) {
            out[i] = max(out[i], cursor)
            cursor = out[i] + blocks[i].extent + gap
        }
        return out
    }

    private fun assignAcross(
        snapshot: FamilySnapshot,
        columns: Map<Int, MutableList<String>>,
    ): Map<String, Float> {
        val keys = columns.keys.sorted()
        val across = mutableMapOf<String, Float>()
        val blocksByLevel = mutableMapOf<Int, List<Block>>()
        val step = personExtent + TreeMetrics.COUPLE_GAP

        keys.forEach { level ->
            val blocks = buildBlocks(snapshot, columns.getValue(level))
            blocksByLevel[level] = blocks
            var cursor = 0f
            blocks.forEach { block ->
                var at = cursor
                block.members.forEach { id ->
                    across[id] = at
                    at += step
                }
                cursor += block.extent + TreeMetrics.STACK_GAP
            }
        }

        val columnSets = keys.associateWith { columns.getValue(it).toSet() }

        repeat(PLACEMENT_PASSES) { pass ->
            val backward = pass % 2 == 0
            val order = if (backward) keys.reversed() else keys

            order.forEach { level ->
                val blocks = blocksByLevel.getValue(level)
                val neighbours = columnSets[level + if (backward) 1 else -1]
                val desired = mutableMapOf<Block, Float>()

                blocks.forEach { block ->
                    val targets = block.members.flatMap { id ->
                        // Going back a parent wants to sit beside the middle of their children;
                        // going on a child wants to sit beside the middle of their parents.
                        val related = if (backward) snapshot.childrenOf[id].orEmpty()
                        else snapshot.parentsOf[id].orEmpty()
                        related.mapNotNull { other ->
                            if (neighbours?.contains(other) == true) {
                                across[other]?.plus(personExtent / 2f)
                            } else null
                        }
                    }
                    // A block with no relatives in the neighbouring column states no wish at all;
                    // placeColumn packs it against its neighbours instead.
                    if (targets.isNotEmpty()) desired[block] = targets.sum() / targets.size
                }

                val placed = placeColumn(blocks, desired)
                blocks.forEachIndexed { i, block ->
                    var at = placed[i]
                    block.members.forEach { id ->
                        across[id] = at
                        at += step
                    }
                }
            }
        }

        return across
    }

    /* ------------------------------------------------------------------ connectors */

    private class Links(
        val spouses: List<WholeSpouseLink>,
        val descents: List<WholeDescentLink>,
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
            if (na.x != nb.x) return@forEach
            val upper = if (na.y < nb.y) na else nb
            val lower = if (na.y < nb.y) nb else na
            // Drawn only when they are actually adjacent; a rule spanning three cards would read as
            // a marriage to whoever sits in between.
            if (lower.y - upper.bottom > TreeMetrics.STACK_GAP) return@forEach
            spouses += WholeSpouseLink(
                x = upper.centerX,
                fromY = upper.bottom,
                toY = lower.y,
                ended = false,
                aId = a,
                bId = b,
            )
        }

        // One descent per parent *set*, which is what puts a couple's children on a single bar and
        // hangs a half-sibling from their own.
        val descents = mutableListOf<WholeDescentLink>()
        snapshot.people.keys
            .mapNotNull { child ->
                val parents = snapshot.parentsOf[child].orEmpty().sorted()
                if (parents.isEmpty()) null else parents to child
            }
            .groupBy({ it.first }, { it.second })
            .forEach { (parentIds, childIds) ->
                val parentNodes = parentIds.mapNotNull { byId[it] }
                val childNodes = childIds.mapNotNull { byId[it] }.sortedBy { it.y }
                if (parentNodes.isEmpty() || childNodes.isEmpty()) return@forEach

                val originX = parentNodes.maxOf { it.right }
                val childLeftX = childNodes.minOf { it.x }
                descents += WholeDescentLink(
                    originX = originX,
                    originY = parentNodes.map { it.centerY }.average().toFloat(),
                    // Just before the nearest child, so a child placed further along gets a longer
                    // stub rather than dragging the whole bar out of place.
                    busX = max(childLeftX - TreeMetrics.GENERATION_GAP * 0.42f, originX + 10f),
                    childYs = childNodes.map { it.centerY },
                    childLeftX = childLeftX,
                    parentIds = parentNodes.map { it.person.id },
                    childIds = childNodes.map { it.person.id },
                )
            }

        val brackets = mutableListOf<SiblingBracket>()
        snapshot.siblingEdges.forEach { (a, b) ->
            val na = byId[a] ?: return@forEach
            val nb = byId[b] ?: return@forEach
            if (na.x != nb.x) return@forEach
            val upper = if (na.y < nb.y) na else nb
            val lower = if (na.y < nb.y) nb else na
            brackets += SiblingBracket(upper.centerY, lower.centerY, upper.x, aId = a, bId = b)
        }

        return Links(spouses, descents, brackets)
    }
}
