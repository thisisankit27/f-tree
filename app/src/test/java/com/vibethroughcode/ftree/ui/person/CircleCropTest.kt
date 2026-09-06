package com.vibethroughcode.ftree.ui.person

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What ends up saved when a photograph is framed.
 *
 * These are the sums the reader cannot check by eye: they choose a face in a circle and get back a
 * square of pixels, and being a few percent out is invisible on the crop screen and permanent in
 * the file. The wide 2000x1000 image is the interesting shape — the circle has room to slide along
 * one axis and none at all along the other.
 */
class CircleCropTest {

    private val wide = 2000 to 1000
    private val diameter = 500f

    private fun scale(zoom: Float = 1f) =
        CircleCrop.baseScale(wide.first, wide.second, diameter) * zoom

    @Test
    fun theSmallestScaleExactlyCoversTheWindow() {
        val base = CircleCrop.baseScale(wide.first, wide.second, diameter)

        // The short side is what has to reach across the circle; anything less would show a
        // crescent of nothing, which is the case the crop screen is built never to allow.
        assertEquals(0.5f, base, 0.0001f)
        assertEquals(diameter, wide.second * base, 0.01f)
    }

    @Test
    fun theShortAxisHasNowhereToGoAndTheLongAxisHasHalfTheOverhang() {
        assertEquals(0f, CircleCrop.offsetLimit(wide.second, scale(), diameter), 0.0001f)
        assertEquals(250f, CircleCrop.offsetLimit(wide.first, scale(), diameter), 0.0001f)
    }

    @Test
    fun untouchedFramingTakesTheMiddleOfThePicture() {
        val crop = CircleCrop.source(wide.first, wide.second, diameter, scale(), 0f, 0f)

        assertEquals(1000, crop.size)
        assertEquals(500, crop.x)
        assertEquals(0, crop.y)
    }

    @Test
    fun draggingToEitherLimitLandsExactlyOnAnEdge() {
        val left = CircleCrop.source(wide.first, wide.second, diameter, scale(), 250f, 0f)
        val right = CircleCrop.source(wide.first, wide.second, diameter, scale(), -250f, 0f)

        assertEquals(0, left.x)
        assertEquals(wide.first - right.size, right.x)
    }

    @Test
    fun zoomingInHalvesTheSquareAndKeepsItCentred() {
        val crop = CircleCrop.source(wide.first, wide.second, diameter, scale(zoom = 2f), 0f, 0f)

        assertEquals(500, crop.size)
        assertEquals(750, crop.x)
        assertEquals(250, crop.y)
    }

    @Test
    fun theSquareIsAlwaysInsideThePictureHoweverFarItIsPushed() {
        // Offsets well past what the screen allows, in case a resize ever lets one through: a crop
        // out of bounds is not a wrong picture, it is a crash out of Bitmap.createBitmap.
        val offsets = listOf(-9000f, -300f, -1f, 0f, 1f, 300f, 9000f)
        val zooms = listOf(1f, 1.3f, 2f, 5.5f)

        for (zoom in zooms) {
            for (x in offsets) {
                for (y in offsets) {
                    val crop = CircleCrop.source(
                        wide.first, wide.second, diameter, scale(zoom), x, y,
                    )
                    assertTrue("$crop at zoom $zoom", crop.x >= 0 && crop.y >= 0)
                    assertTrue("$crop at zoom $zoom", crop.x + crop.size <= wide.first)
                    assertTrue("$crop at zoom $zoom", crop.y + crop.size <= wide.second)
                    assertTrue("$crop at zoom $zoom", crop.size > 0)
                }
            }
        }
    }

    @Test
    fun aPictureWithNoPixelsAsksForNothingRatherThanFailing() {
        assertEquals(0, CircleCrop.source(0, 0, diameter, 1f, 0f, 0f).size)
        assertEquals(1f, CircleCrop.baseScale(0, 0, diameter), 0.0001f)
    }

    @Test
    fun aTallPictureSlidesVerticallyInstead() {
        val crop = CircleCrop.source(1000, 2000, diameter, 0.5f, 0f, 250f)

        assertEquals(1000, crop.size)
        assertEquals(0, crop.x)
        assertEquals(0, crop.y)
    }
}
