package com.vibethroughcode.ftree.ui.tree

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.unit.IntSize
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The rule that stops a chart being dragged off its own page. */
class ChartViewportTest {

    private val viewport = IntSize(1080, 2000)
    private val keep = 200f

    private fun clamp(x: Float, y: Float, w: Float = 4000f, h: Float = 6000f) =
        clampPan(Offset(x, y), w, h, viewport, keep)

    @Test
    fun `a pan that keeps the chart on screen is left alone`() {
        assertEquals(Offset(-500f, -900f), clamp(-500f, -900f))
    }

    @Test
    fun `dragging the chart off to the left stops with a strip of it showing`() {
        val panned = clamp(-9999f, 0f)
        assertEquals(keep, panned.x + 4000f, 0.01f)
    }

    @Test
    fun `dragging the chart off to the right stops with a strip of it showing`() {
        val panned = clamp(9999f, 0f)
        assertEquals(viewport.width - keep, panned.x, 0.01f)
    }

    @Test
    fun `it holds vertically on the same rule`() {
        assertEquals(keep, clamp(0f, -9999f).y + 6000f, 0.01f)
        assertEquals(viewport.height - keep, clamp(0f, 9999f).y, 0.01f)
    }

    @Test
    fun `a chart smaller than the strip is held whole rather than by part of itself`() {
        val panned = clamp(-9999f, -9999f, w = 160f, h = 60f)
        assertTrue(panned.x + 160f >= 0f)
        assertTrue(panned.y + 60f >= 0f)
        assertTrue(panned.x <= viewport.width)
        assertTrue(panned.y <= viewport.height)
    }

    @Test
    fun `it does nothing before the viewport has been measured`() {
        val pan = Offset(-9999f, -9999f)
        assertEquals(pan, clampPan(pan, 4000f, 6000f, IntSize.Zero, keep))
    }
}
