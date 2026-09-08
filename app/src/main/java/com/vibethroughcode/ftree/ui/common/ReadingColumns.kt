package com.vibethroughcode.ftree.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Lays a handful of self-contained blocks out in as many columns as the width deserves.
 *
 * A settings page and a person's relatives are not one long thing; they are six or seven short
 * ones stacked because a phone is narrow. Given a landscape phone or a tablet they should stand
 * beside each other rather than leave half the glass empty and make the reader scroll past it.
 *
 * How many columns is [readableColumns]' decision, so every screen in the app breaks at the same
 * widths. Each block is then given a whole column and dropped into whichever column is currently
 * shortest, which is what keeps two columns of unequal blocks ending at roughly the same place —
 * a plain half-and-half split would put the tall one on one side and leave the other stranded.
 * With everything the same height, or with one column, that rule degenerates to the obvious
 * answer: straight down the page, in the order written.
 *
 * Not lazy, deliberately. There are six sections, not six hundred; laziness would buy nothing and
 * would cost the page its ability to be scrolled to by anything that is not currently on screen —
 * which is how the whole app is tested.
 *
 * Each direct child must emit exactly one layout node. Wrap a run of them in a `Column`.
 */
@Composable
fun ReadingColumns(
    modifier: Modifier = Modifier,
    gutter: Dp = 32.dp,
    content: @Composable () -> Unit,
) {
    Layout(modifier = modifier, content = content) { measurables, constraints ->
        val available = constraints.maxWidth
        val count = readableColumns(available.toDp())
        val gutterPx = gutter.roundToPx()
        val columnWidth = (available - gutterPx * (count - 1)) / count

        val placeables = measurables.map {
            it.measure(
                Constraints(
                    minWidth = columnWidth,
                    maxWidth = columnWidth,
                    minHeight = 0,
                    maxHeight = Constraints.Infinity,
                )
            )
        }

        val filled = IntArray(count)
        val offsets = placeables.map { placeable ->
            val column = (0 until count).minBy { filled[it] }
            val offset = column * (columnWidth + gutterPx) to filled[column]
            filled[column] += placeable.height
            offset
        }

        layout(available, filled.maxOrNull() ?: 0) {
            placeables.forEachIndexed { index, placeable ->
                val (x, y) = offsets[index]
                placeable.place(x, y)
            }
        }
    }
}
