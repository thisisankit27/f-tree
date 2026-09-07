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
 *
 * It carries the people it joins as well as the coordinates, because a connector that cannot say
 * whose it is cannot take part in anything the chart does with a selection. Without them the only
 * honest thing a highlight could do was fade the cards and leave every line at full strength —
 * which is to dim the hundred and forty people you can already tell apart and keep the lattice you
 * cannot.
 */
data class DescentLink(
    val originX: Float,
    val originY: Float,
    val busY: Float,
    val childXs: List<Float>,
    val childTopY: Float,
    val parentIds: List<String> = emptyList(),
    /** In the same order as [childXs], so a drop and a child can be matched up. */
    val childIds: List<String> = emptyList(),
) {
    /** Whether this connector runs to or from [personId] — a parent on it, or one of the children. */
    fun touches(personId: String): Boolean = personId in parentIds || personId in childIds

    /**
     * The horizontal bar's extent: from the parents' stem across to the far side of the children.
     *
     * Expressed here rather than worked out at drawing time so that "the bar reaches everything it
     * has to join" is a property of the connector that a test can hold it to, instead of a detail
     * of one canvas that happened to be right. Drawing the bar between the children alone is what
     * left a stem hanging in mid-air whenever the parents sat outside their own children's span.
     */
    val barStart: Float get() = minOf(originX, childXs.minOrNull() ?: originX)
    val barEnd: Float get() = maxOf(originX, childXs.maxOrNull() ?: originX)
}

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
    /**
     * A card holds a face and a name side by side, so it is wider than a card holding only words.
     *
     * The avatar is part of the card at every zoom and whether or not there is a photograph behind
     * it, which is what lets the "photos in the chart" setting be turned on and off without a
     * single person moving: the setting changes what is drawn inside the circle, never the shape of
     * the chart around it.
     */
    const val NODE_WIDTH = 160f
    const val NODE_HEIGHT = 60f

    /** The avatar's diameter and the space around it, as fractions of a card's height. */
    const val AVATAR_DIAMETER = 0.6f
    const val AVATAR_INSET = 0.13f

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
        val eased = cardScaleFor(textScale)
        return NODE_WIDTH * eased to NODE_HEIGHT * eased
    }

    /**
     * How much a card grows at the reader's text size, as a multiplier.
     *
     * Shared with the compact view so the two ways of showing a person agree about how much room a
     * larger word needs. Tempered rather than full scale for the reason above: a chart is a spatial
     * overview, and a card that doubles leaves almost nothing on screen.
     */
    fun cardScaleFor(textScale: Float): Float =
        1f + (textScale.coerceIn(1f, 2f) - 1f) * 0.7f
}
