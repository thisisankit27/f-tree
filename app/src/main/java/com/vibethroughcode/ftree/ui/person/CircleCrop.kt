package com.vibethroughcode.ftree.ui.person

import com.vibethroughcode.ftree.data.SquareCrop
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * The arithmetic behind framing a photograph in a circle.
 *
 * Kept apart from the composable that draws it, and free of any Android or Compose type, so the
 * part that can be wrong — which pixels of the original end up saved — is testable on the JVM
 * rather than only visible by eye on a device.
 *
 * The model is the one the reader sees: a fixed circular window in the middle of the screen, with
 * the photograph moved and scaled behind it. [baseScale] is the scale at which the picture exactly
 * covers that window, so the window can never contain a corner of empty space, and [offsetLimit]
 * is what keeps it that way while the picture is dragged.
 */
object CircleCrop {

    /** How far in the reader may zoom, beyond the scale that just covers the window. */
    const val MAX_ZOOM = 6f

    /** The smallest scale at which the photograph still covers the circular window. */
    fun baseScale(imageWidth: Int, imageHeight: Int, diameter: Float): Float {
        if (imageWidth <= 0 || imageHeight <= 0 || diameter <= 0f) return 1f
        return max(diameter / imageWidth, diameter / imageHeight)
    }

    /**
     * How far the photograph may be dragged from centre before the window would run off its edge.
     *
     * Zero on an axis means the picture is exactly as wide (or tall) as the window there and has
     * nowhere to go, which is the usual case for one of the two axes.
     */
    fun offsetLimit(imageSide: Int, scale: Float, diameter: Float): Float =
        max(0f, imageSide * scale / 2f - diameter / 2f)

    /**
     * The square of the original that the circular window is currently over.
     *
     * A square, not a circle: the roundness is drawn by every place that shows a face, so storing
     * a round image would only mean carrying an alpha channel to save a shape we redraw anyway.
     */
    fun source(
        imageWidth: Int,
        imageHeight: Int,
        diameter: Float,
        scale: Float,
        offsetX: Float,
        offsetY: Float,
    ): SquareCrop {
        if (imageWidth <= 0 || imageHeight <= 0 || scale <= 0f) return SquareCrop(0, 0, 0)

        val side = (diameter / scale)
        val x = (imageWidth * scale / 2f - diameter / 2f - offsetX) / scale
        val y = (imageHeight * scale / 2f - diameter / 2f - offsetY) / scale

        // Rounded, then held inside the picture: a pixel of drift at the edge would otherwise
        // become an IllegalArgumentException out of Bitmap.createBitmap.
        val size = side.roundToInt().coerceIn(1, minOf(imageWidth, imageHeight))
        return SquareCrop(
            x = x.roundToInt().coerceIn(0, imageWidth - size),
            y = y.roundToInt().coerceIn(0, imageHeight - size),
            size = size,
        )
    }
}
