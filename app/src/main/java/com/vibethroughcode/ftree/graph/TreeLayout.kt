package com.vibethroughcode.ftree.graph

import com.vibethroughcode.ftree.data.Person

/**
 * A person placed on the chart. [x] and [y] are the top-left corner, in layout units.
 *
 * Each node carries its own box size because the chart honours the reader's text size: at a large
 * accessibility scale the cards grow with the words rather than letting the words spill out.
 */
data class TreeNode(
    val person: Person,
    val level: Int,
    val x: Float,
    val y: Float,
    val isFocus: Boolean,
    val width: Float = TreeMetrics.NODE_WIDTH,
    val height: Float = TreeMetrics.NODE_HEIGHT,
) {
    val centerX: Float get() = x + width / 2f
    val centerY: Float get() = y + height / 2f
    val bottom: Float get() = y + height
}

/** The doubled rule drawn between partners. */
data class SpouseLink(val fromX: Float, val toX: Float, val y: Float)

/**
 * One family's descent: a drop from the parents, a bar across the children, and a drop to each.
 *
 * Grouped by *parent set* rather than by individual parent, so a couple's children hang from one
 * connector while a half-sibling hangs from their own — which is what makes a second marriage
 * legible instead of a tangle of crossing lines.
 */
data class DescentLink(
    val originX: Float,
    val originY: Float,
    val busY: Float,
    val childXs: List<Float>,
    val childTopY: Float,
)

data class TreeLayout(
    val nodes: List<TreeNode> = emptyList(),
    val spouseLinks: List<SpouseLink> = emptyList(),
    val descentLinks: List<DescentLink> = emptyList(),
    val width: Float = 0f,
    val height: Float = 0f,
    val focusId: String? = null,
    /** True when people were left out because they sit beyond the loaded generations. */
    val truncated: Boolean = false,
) {
    val isEmpty: Boolean get() = nodes.isEmpty()

    fun nodeAt(x: Float, y: Float): TreeNode? = nodes.firstOrNull {
        x >= it.x && x <= it.x + it.width && y >= it.y && y <= it.y + it.height
    }

    fun node(personId: String): TreeNode? = nodes.firstOrNull { it.person.id == personId }
}

/** Chart geometry, in dp-equivalent layout units. */
object TreeMetrics {
    const val NODE_WIDTH = 132f
    const val NODE_HEIGHT = 56f

    /**
     * Between unrelated nodes on the same row. Deliberately much wider than [COUPLE_GAP]: the
     * difference in spacing is what tells you at a glance that two adjacent cards are a couple
     * rather than just neighbours.
     */
    const val SIBLING_GAP = 36f

    /** Between partners, kept tight so a couple reads as one block. */
    const val COUPLE_GAP = 12f

    /** Between generations, leaving room for the descent connectors. */
    const val LEVEL_GAP = 76f

    const val MARGIN = 24f

    /**
     * How much bigger a card gets at the reader's text size.
     *
     * Applied at less than the full scale: a chart is a spatial overview, and growing every card by
     * 1.8x would leave almost nothing on screen. Words are never clipped — the card grows enough to
     * hold them — but the growth is tempered, and the people list, which honours the setting in
     * full, remains the readable route through a large family.
     */
    fun nodeSizeFor(textScale: Float): Pair<Float, Float> {
        val eased = 1f + (textScale.coerceIn(1f, 2f) - 1f) * 0.7f
        return NODE_WIDTH * eased to NODE_HEIGHT * eased
    }
}
