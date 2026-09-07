package com.vibethroughcode.ftree.ui.tree

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.IntSize

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
 * Keeping the centre inside the drawing is a real guarantee instead. The outermost cards are what
 * define the edges of it, so wherever the centre lands, one of them is within half a screen and
 * therefore in view. It is also the rule a map uses, and it reads the same way: the paper can be
 * pushed until its edge reaches the middle, and no further.
 */
internal fun clampPan(
    pan: Offset,
    contentWidth: Float,
    contentHeight: Float,
    viewport: IntSize,
): Offset {
    if (viewport.width == 0 || viewport.height == 0) return pan
    return Offset(
        x = clampAxis(pan.x, contentWidth, viewport.width),
        y = clampAxis(pan.y, contentHeight, viewport.height),
    )
}

/**
 * The range a single axis may be panned through.
 *
 * The chart occupies `[offset, offset + content]` in screen space, so the point under the middle of
 * the screen is `viewport / 2 - offset` in the chart's own coordinates. Requiring that to stay
 * within `[0, content]` gives both ends at once.
 */
private fun clampAxis(offset: Float, content: Float, viewport: Int): Float {
    val middle = viewport / 2f
    return offset.coerceIn(middle - content, middle)
}
