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
}
