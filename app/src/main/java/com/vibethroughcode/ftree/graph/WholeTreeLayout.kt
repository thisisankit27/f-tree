package com.vibethroughcode.ftree.graph

import com.vibethroughcode.ftree.data.Person

/**
 * A chart of the entire tree rather than one person's neighbourhood.
 *
 * [TreeLayout] is ego-centric because that is the right answer on a phone showing one person's
 * family. This is the other view: everybody at once, including the people no relationship reaches,
 * whom an ego-centric chart has nowhere to put at all. It is the same picture the web viewer draws.
 */
data class WholeTreeNode(
    val person: Person,
    /** Row within the person's own shelf; -1 for somebody no relationship reaches. */
    val level: Int,
    val x: Float,
    val y: Float,
    val groupIndex: Int,
) {
    val centerX: Float get() = x + TreeMetrics.NODE_WIDTH / 2f
    val centerY: Float get() = y + TreeMetrics.NODE_HEIGHT / 2f
    val bottom: Float get() = y + TreeMetrics.NODE_HEIGHT
}

/** The doubled rule between partners, as [SpouseLink] but carrying which pair it joins. */
data class WholeSpouseLink(val fromX: Float, val toX: Float, val y: Float, val ended: Boolean)

/**
 * A bracket over siblings whose shared parents are unknown.
 *
 * Derived siblings hang from their family's descent bar; these have no bar to hang from, so they
 * get a notation of their own. Dashed, because what joins them is the part nobody wrote down.
 */
data class SiblingBracket(val fromX: Float, val toX: Float, val y: Float)

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

/** A faint rule marking one generation across a shelf. */
data class GenerationBand(val level: Int, val y: Float, val x: Float, val width: Float)

data class WholeTreeLayout(
    val nodes: List<WholeTreeNode> = emptyList(),
    val spouseLinks: List<WholeSpouseLink> = emptyList(),
    val descentLinks: List<DescentLink> = emptyList(),
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
