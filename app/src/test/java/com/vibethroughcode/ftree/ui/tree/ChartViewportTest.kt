package com.vibethroughcode.ftree.ui.tree

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.IntSize
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The rule that stops a chart being dragged off its own page: the middle of the screen stays over
 * the chart.
 */
class ChartViewportTest {

    private val viewport = IntSize(1080, 2000)
    private val midX = 540f
    private val midY = 1000f

    private fun clamp(x: Float, y: Float, w: Float = 4000f, h: Float = 6000f) =
        clampPan(Offset(x, y), w, h, viewport)

    /** Where the middle of the screen falls, in the chart's own coordinates. */
    private fun centreOver(pan: Offset, viewport: IntSize = this.viewport) =
        Offset(viewport.width / 2f - pan.x, viewport.height / 2f - pan.y)

    @Test
    fun `a pan that keeps the middle over the chart is left alone`() {
        assertEquals(Offset(-500f, -900f), clamp(-500f, -900f))
    }

    @Test
    fun `dragging the chart away to the left stops when its far edge reaches the middle`() {
        val panned = clamp(-99999f, 0f)
        assertEquals(4000f, centreOver(panned).x, 0.01f)
    }

    @Test
    fun `dragging it the other way stops when its near edge reaches the middle`() {
        val panned = clamp(99999f, 0f)
        assertEquals(0f, centreOver(panned).x, 0.01f)
    }

    @Test
    fun `it holds vertically on the same rule`() {
        assertEquals(6000f, centreOver(clamp(0f, -99999f)).y, 0.01f)
        assertEquals(0f, centreOver(clamp(0f, 99999f)).y, 0.01f)
    }

    @Test
    fun `the middle stays over the chart however hard it is thrown`() {
        for (x in listOf(-99999f, -4000f, 0f, 4000f, 99999f)) {
            for (y in listOf(-99999f, -6000f, 0f, 6000f, 99999f)) {
                val c = centreOver(clamp(x, y))
                assertTrue("x=$x y=$y gave $c", c.x in 0f..4000f && c.y in 0f..6000f)
            }
        }
    }

    @Test
    fun `a lone person cannot be pushed off either`() {
        // 160 x 60 layout units at roughly 2.6px each.
        val w = 420f
        val h = 157f
        val panned = clampPan(Offset(-99999f, -99999f), w, h, viewport)
        val c = centreOver(panned)
        assertTrue(c.x in 0f..w && c.y in 0f..h)
    }

    @Test
    fun `it does nothing before the viewport has been measured`() {
        val pan = Offset(-99999f, -99999f)
        assertEquals(pan, clampPan(pan, 4000f, 6000f, IntSize.Zero))
    }

    /*
     * A sideways chart is mostly empty paper: the earliest generation holds two people and the
     * latest holds sixty. These are the cases where the outline and the drawing disagree.
     */

    /** A short generation beside a long one, the shape that made this matter. */
    private val short = ChartColumn(left = 0f, right = 160f, top = 400f, bottom = 700f)
    private val long = ChartColumn(left = 264f, right = 424f, top = 0f, bottom = 3000f)

    @Test
    fun `following a generation down stops at the end of what is drawn there`() {
        // Only the short generation is on screen, and the drag runs far past its last card.
        val narrow = IntSize(200, 2000)
        val panned = clampPan(
            pan = Offset(0f, -99999f),
            contentWidth = 4000f, contentHeight = 6000f,
            viewport = narrow,
            columns = listOf(short, long),
            scale = 1f,
        )
        val centre = 1000f - panned.y
        assertEquals("the middle must rest on the last card, not below it", 700f, centre, 0.01f)
    }

    @Test
    fun `a short generation still scrolls as far as the long one beside it`() {
        // Both on screen: the eye follows the neighbour down, so the clamp lets it.
        val panned = clampPan(
            pan = Offset(0f, -99999f),
            contentWidth = 4000f, contentHeight = 6000f,
            viewport = viewport,
            columns = listOf(short, long),
            scale = 1f,
        )
        assertEquals(3000f, midY - panned.y, 0.01f)
    }

    @Test
    fun `the middle never leaves the cards, whichever way it is dragged`() {
        val columns = listOf(short, long)
        listOf(
            Offset(99999f, 99999f), Offset(-99999f, -99999f),
            Offset(99999f, -99999f), Offset(-99999f, 99999f),
        ).forEach { wild ->
            val panned = clampPan(wild, 4000f, 6000f, viewport, columns, 1f)
            val centre = centreOver(panned)
            val onScreen = columns.filter {
                it.right >= -panned.x && it.left <= -panned.x + viewport.width
            }.ifEmpty { columns }
            assertTrue(
                "centre $centre is off the drawing",
                centre.x >= columns.minOf { it.left } - 0.01f &&
                    centre.x <= columns.maxOf { it.right } + 0.01f &&
                    centre.y >= onScreen.minOf { it.top } - 0.01f &&
                    centre.y <= onScreen.maxOf { it.bottom } + 0.01f,
            )
        }
    }

    @Test
    fun `zoom is taken into account, so the rule holds at every scale`() {
        val panned = clampPan(
            pan = Offset(0f, -99999f),
            contentWidth = 4000f, contentHeight = 6000f,
            viewport = viewport,
            columns = listOf(short, long),
            scale = 0.5f,
        )
        // The cards are half as far apart on screen, so the limit halves with them.
        assertEquals(1500f, midY - panned.y, 0.01f)
    }

    @Test
    fun `with no columns given it falls back to the chart's outline`() {
        assertEquals(clamp(-99999f, -99999f), clampPan(Offset(-99999f, -99999f), 4000f, 6000f, viewport))
    }
}