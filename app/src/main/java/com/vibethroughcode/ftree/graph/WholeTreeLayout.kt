package com.vibethroughcode.ftree.graph

import com.vibethroughcode.ftree.data.Person

/**
 * A chart of the entire tree rather than one person's neighbourhood — drawn sideways.
 *
 * [TreeLayout] is ego-centric because that is the right answer on a phone showing one person's
 * family. This is the other view: everybody at once, including the people no relationship reaches,
 * whom an ego-centric chart has nowhere to put at all.
 *
 * It runs **left to right**: a generation is a column, ancestors at the left, descendants to the
 * right, and the people of one generation stacked down the screen. Drawn the ordinary way round —
 * a generation to a row — a real family record is a ribbon. Ankit's is 78 cards wide and 5 tall, an
 * aspect of fifteen, against a phone's of about a half, and it sits at ninety-nine per cent of the
 * least width it could possibly occupy: the widest generation genuinely holds sixty-four people, so
 * there is no packing to be won and nothing to fix in the arithmetic. The chart was simply the
 * wrong way round for the shape of the thing it is read on. Turned on its side the same record is
 * about five columns by sixty-four people: you scroll down through a generation, which is what a
 * phone is for, and step sideways only a handful of times to cross the whole family.
 *
 * The cost is that every connector is rotated too, so this file carries its own — a marriage is a
 * doubled rule down the side of a couple rather than across it, and a descent runs out to the right
 * before it spreads. They are separate types rather than the ego chart's reused with the axes
 * quietly swapped, because a coordinate whose meaning depends on which chart is reading it is a bug
 * that compiles.
 */
data class WholeTreeNode(
    val person: Person,
    /** Column within the person's own shelf; -1 for somebody no relationship reaches. */
    val level: Int,
    val x: Float,
    val y: Float,
    val groupIndex: Int,
) {
    val centerX: Float get() = x + TreeMetrics.NODE_WIDTH / 2f
    val centerY: Float get() = y + TreeMetrics.NODE_HEIGHT / 2f
    val right: Float get() = x + TreeMetrics.NODE_WIDTH
    val bottom: Float get() = y + TreeMetrics.NODE_HEIGHT
}

/**
 * The doubled rule between partners, drawn down the side of the couple.
 *
 * Vertical, because the couple is stacked: one above the other in their generation's column.
 */
data class WholeSpouseLink(
    val x: Float,
    val fromY: Float,
    val toY: Float,
    val ended: Boolean,
    val aId: String = "",
    val bId: String = "",
) {
    fun touches(personId: String): Boolean = personId == aId || personId == bId
}

/**
 * One family's descent, running sideways: out to the right of the parents, a bar down the children,
 * and a stub into each.
 *
 * [DescentLink] turned through a right angle, and the same rule holds — the bar spans the parents'
 * stem as well as every child, so a couple sitting outside the run of their own children still has
 * a connector that reaches them rather than one ending in mid-air.
 */
data class WholeDescentLink(
    /** Where the stem leaves the parents: their right edge, at their middle. */
    val originX: Float,
    val originY: Float,
    /** The column the bar stands in, between the parents and the children. */
    val busX: Float,
    val childYs: List<Float>,
    /** The left edge of the children's column, where each stub arrives. */
    val childLeftX: Float,
    val parentIds: List<String> = emptyList(),
    /** In the same order as [childYs], so a stub and a child can be matched up. */
    val childIds: List<String> = emptyList(),
) {
    fun touches(personId: String): Boolean = personId in parentIds || personId in childIds

    val barStart: Float get() = minOf(originY, childYs.minOrNull() ?: originY)
    val barEnd: Float get() = maxOf(originY, childYs.maxOrNull() ?: originY)
}

/**
 * A bracket beside siblings whose shared parents are unknown.
 *
 * Derived siblings hang from their family's descent bar; these have no bar to hang from, so they
 * get a notation of their own. Dashed, because what joins them is the part nobody wrote down.
 */
data class SiblingBracket(
    val fromY: Float,
    val toY: Float,
    val x: Float,
    val aId: String = "",
    val bId: String = "",
) {
    fun touches(personId: String): Boolean = personId == aId || personId == bId
}

/** One connected family, framed and counted. */
data class TreeGroup(
    val x: Float,
    val y: Float,
    val width: Float,
    val height: Float,
    val memberCount: Int,
    val generations: Int,
    /** True for the block of people no relationship reaches. */
    val unconnected: Boolean,
    val memberIds: List<String>,
)

/** A faint rule marking one generation down a shelf. */
data class GenerationBand(val level: Int, val x: Float, val y: Float, val height: Float)

data class WholeTreeLayout(
    val nodes: List<WholeTreeNode> = emptyList(),
    val spouseLinks: List<WholeSpouseLink> = emptyList(),
    val descentLinks: List<WholeDescentLink> = emptyList(),
    val siblingBrackets: List<SiblingBracket> = emptyList(),
    val groups: List<TreeGroup> = emptyList(),
    val bands: List<GenerationBand> = emptyList(),
    val width: Float = 0f,
    val height: Float = 0f,
    /** People recorded with no relationship at all. The ego-centric chart cannot show these. */
    val unconnectedCount: Int = 0,
    val generations: Int = 0,
) {
    val isEmpty: Boolean get() = nodes.isEmpty()

    private val byId: Map<String, WholeTreeNode> = nodes.associateBy { it.person.id }

    fun node(personId: String): WholeTreeNode? = byId[personId]

    fun nodeAt(x: Float, y: Float): WholeTreeNode? = nodes.firstOrNull {
        x >= it.x && x <= it.x + TreeMetrics.NODE_WIDTH &&
            y >= it.y && y <= it.y + TreeMetrics.NODE_HEIGHT
    }
}
