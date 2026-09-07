package com.vibethroughcode.ftree.ui.tree

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.IntSize

/**
 * One generation's cards: how far they reach along both axes, in layout units.
 *
 * A chart that runs sideways is mostly empty paper. The earliest generation holds two people and
 * the latest holds sixty, so a column is short exactly where its neighbour is long — and a rule
 * that only kept the middle of the screen inside the chart's *rectangle* let a reader scroll down
 * past the end of the column they were following into a blank sheet, with the populated columns
 * beside them off the edge. Knowing where each generation starts and stops is what lets the clamp
 * follow the drawing rather than the page it is drawn on.
 */
internal data class ChartColumn(
    val left: Float,
    val right: Float,
    val top: Float,
    val bottom: Float,
)

/**
 * Keeps a chart from being dragged off its own page.
 *
 * Both charts are a canvas the size of the family, panned by a finger with nothing to stop it. Six
 * ordinary swipes on a phone is enough to push a thirteen-person tree entirely out of the viewport,
 * and what is left is a blank sheet under a heading that still says thirteen people — with no
 * control anywhere that brings it back. Leaving the screen and returning re-frames it, but nothing
 * says so, and "the family I have been keeping is gone" is the worst sentence this app could put in
 * somebody's head.
 *
 * The rule is that **the middle of the screen stays over the chart**. Holding the chart's outline
 * on screen is not enough: a family tree is a sparse drawing inside a rectangle, so its bottom-right
 * corner is usually empty paper, and a clamp that only kept the rectangle honest still allowed a
 * blank screen — which is how this was first written, and what measuring the pixels caught.
 *
 * Keeping the centre inside the drawing is a real guarantee instead. It is also the rule a map
 * uses, and it reads the same way: the paper can be pushed until its edge reaches the middle, and
 * no further.
 *
 * "The drawing" means the cards, not the rectangle around them — see [ChartColumn]. Turning the
 * charts sideways made the difference matter: a chart is now tall and its generations are short
 * exactly where their neighbours are long, so the outline is mostly paper nobody has drawn on.
 */
internal fun clampPan(
    pan: Offset,
    contentWidth: Float,
    contentHeight: Float,
    viewport: IntSize,
    /** The generations, in layout units. Empty falls back to the chart's outline. */
    columns: List<ChartColumn> = emptyList(),
    /** Layout units to screen pixels, at the current zoom. */
    scale: Float = 1f,
): Offset {
    if (viewport.width == 0 || viewport.height == 0) return pan
    if (columns.isEmpty()) {
        return Offset(
            x = clampAxis(pan.x, contentWidth, viewport.width),
            y = clampAxis(pan.y, contentHeight, viewport.height),
        )
    }

    val midX = viewport.width / 2f
    val midY = viewport.height / 2f

    // Sideways, so the horizontal limit is the first and last generation.
    val first = columns.minOf { it.left } * scale
    val last = columns.maxOf { it.right } * scale
    val x = pan.x.coerceIn(midX - last, midX - first)

    /*
     * Vertically, only the generations actually on screen have a say.
     *
     * Following one generation down and stopping at the end of it is right; being allowed to carry
     * on into empty paper is not. Taking the union over what is visible rather than the column
     * under the exact middle means a short generation beside a long one still scrolls — you keep
     * going, and what you are following becomes the neighbour, which is what the eye does anyway.
     */
    val left = -x
    val right = left + viewport.width
    val onScreen = columns.filter { it.right * scale >= left && it.left * scale <= right }
        .ifEmpty { columns }
    val top = onScreen.minOf { it.top } * scale
    val bottom = onScreen.maxOf { it.bottom } * scale
    val y = pan.y.coerceIn(midY - bottom, midY - top)

    return Offset(x, y)
}

/**
 * The range a single axis may be panned through, when all that is known is the chart's outline.
 *
 * The chart occupies `[offset, offset + content]` in screen space, so the point under the middle of
 * the screen is `viewport / 2 - offset` in the chart's own coordinates. Requiring that to stay
 * within `[0, content]` gives both ends at once.
 */
private fun clampAxis(offset: Float, content: Float, viewport: Int): Float {
    val middle = viewport / 2f
    return offset.coerceIn(middle - content, middle)
}
