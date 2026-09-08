package com.vibethroughcode.ftree.ui.common

import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The rule that decides how many columns a pane is read in.
 *
 * Written against real widths rather than round numbers, because the widths are the point: these
 * are the panes the app is actually handed once a navigation rail and a display cutout have taken
 * their share, and the bug this rule fixes was a landscape phone showing a column of names beside
 * two hundred points of nothing.
 */
class ReadableColumnsTest {

    @Test
    fun `an upright phone reads in one column`() {
        assertEquals(1, readableColumns(411.dp))
        assertEquals(1, readableColumns(360.dp))
    }

    @Test
    fun `a landscape phone reads in two`() {
        // A 914dp window less the rail and the cutout beside it: what the emulator actually gives.
        assertEquals(2, readableColumns(750.dp))
        // A narrower phone, where the pane is only just wide enough to be worth splitting.
        assertEquals(2, readableColumns(644.dp))
    }

    @Test
    fun `a tablet reads in three`() {
        assertEquals(3, readableColumns(1280.dp))
        assertEquals(3, readableColumns(1600.dp))
    }

    @Test
    fun `no column is ever wider than the measure once there is room for two`() {
        var width = 640
        while (width <= 2400) {
            val columns = readableColumns(width.dp)
            val each = width.toFloat() / columns
            assertTrue("$width dp in $columns columns is ${each}dp each", each <= 560f)
            width += 1
        }
    }

    @Test
    fun `no column is ever narrower than a name and a date`() {
        var width = 1
        while (width <= 2400) {
            val columns = readableColumns(width.dp)
            val each = width.toFloat() / columns
            assertTrue("$width dp in $columns columns is ${each}dp each", columns == 1 || each >= 320f)
            width += 1
        }
    }

    /**
     * Just past one measure, splitting would buy two columns too cramped to hold a name and a
     * date, so the width is taken as a slightly long line instead. This is the only place a column
     * is allowed past the measure, and it ends where two real columns become possible.
     */
    @Test
    fun `the band above one measure stays a single column`() {
        assertEquals(1, readableColumns(561.dp))
        assertEquals(1, readableColumns(639.dp))
        assertEquals(2, readableColumns(640.dp))
    }

    @Test
    fun `a pane with no width still asks for one column`() {
        assertEquals(1, readableColumns(0.dp))
    }
}
