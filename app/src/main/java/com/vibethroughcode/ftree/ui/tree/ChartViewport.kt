package com.vibethroughcode.ftree.ui.tree

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp

/**
 * How much of a chart a drag must leave on screen.
 *
 * Roughly a card and a half: enough to see what you are holding on to and to drag back by, without
 * making the edge of a large family feel fenced in.
 */
internal val KEEP_ON_SCREEN = 96.dp

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
 * So a strip of the chart is always held on screen. It is a clamp rather than a bounce because a
 * chart is a document being read, not a list being flung: it should stop where it stops, and the
 * edge should feel like the edge of the paper.
 *
 * [keep] is how much of the chart must remain, in pixels. Where a chart is smaller than that in an
 * axis the whole of it is held instead, so a lone person cannot be pushed off either.
 */
internal fun clampPan(
    pan: Offset,
    contentWidth: Float,
    contentHeight: Float,
    viewport: IntSize,
    keep: Float,
): Offset {
    if (viewport.width == 0 || viewport.height == 0) return pan
    return Offset(
        x = clampAxis(pan.x, contentWidth, viewport.width, keep),
        y = clampAxis(pan.y, contentHeight, viewport.height, keep),
    )
}

/**
 * The range a single axis may be panned through.
 *
 * The chart occupies `[offset, offset + content]` in screen space. Requiring that span to overlap
 * `[0, viewport]` by at least [keep] gives both ends directly: the chart's trailing edge cannot come
 * in past [keep], and its leading edge cannot go out past the same distance from the far side.
 */
private fun clampAxis(offset: Float, content: Float, viewport: Int, keep: Float): Float {
    val visible = minOf(keep, content)
    val min = visible - content
    val max = viewport - visible
    // A chart far larger than the viewport gives min < max; a tiny one can invert the range, and
    // then the only sensible answer is the one position that satisfies both ends.
    return if (min <= max) offset.coerceIn(min, max) else (min + max) / 2f
}
