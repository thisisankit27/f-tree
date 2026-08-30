package com.vibethroughcode.ftree.ui.common

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.unit.dp

/**
 * The app's mark: a fragment of a pedigree chart.
 *
 * A couple joined by the doubled rule that means marriage, two children hanging beneath on a
 * sibling bar, and one of them still unknown — drawn dashed in brass. It is the same notation the
 * family chart uses, so the empty screen is already teaching the language the rest of the app
 * speaks. Decorative, so it is hidden from screen readers.
 */
@Composable
fun TreeGlyph(modifier: Modifier = Modifier) {
    val ink = MaterialTheme.colorScheme.onSurface
    val accents = com.vibethroughcode.ftree.ui.theme.FTreeTheme.accents

    Canvas(
        modifier = modifier
            .size(width = 132.dp, height = 84.dp)
            .clearAndSetSemantics {},
    ) {
        val r = 9.dp.toPx()
        val stroke = 1.5.dp.toPx()
        val topY = r + 2.dp.toPx()
        val bottomY = size.height - r - 2.dp.toPx()
        val midY = (topY + bottomY) / 2f

        val leftParent = Offset(size.width * 0.32f, topY)
        val rightParent = Offset(size.width * 0.68f, topY)
        val leftChild = Offset(size.width * 0.18f, bottomY)
        val rightChild = Offset(size.width * 0.82f, bottomY)
        val centre = (leftParent.x + rightParent.x) / 2f

        // Marriage: a doubled horizontal rule between the pair.
        val gap = 1.6.dp.toPx()
        listOf(-gap, gap).forEach { dy ->
            drawLine(
                color = accents.spouseLink,
                start = Offset(leftParent.x + r, topY + dy),
                end = Offset(rightParent.x - r, topY + dy),
                strokeWidth = stroke,
            )
        }

        // Descent: down from the union, along the sibling bar, down to each child.
        drawLine(ink, Offset(centre, topY + r), Offset(centre, midY), strokeWidth = stroke)
        drawLine(ink, Offset(leftChild.x, midY), Offset(rightChild.x, midY), strokeWidth = stroke)
        drawLine(ink, Offset(leftChild.x, midY), Offset(leftChild.x, bottomY - r), strokeWidth = stroke)
        drawLine(ink, Offset(rightChild.x, midY), Offset(rightChild.x, bottomY - r), strokeWidth = stroke)

        listOf(leftParent, rightParent, leftChild).forEach {
            drawCircle(color = ink, radius = r, center = it, style = Stroke(width = stroke))
        }

        // The one we don't have a name for.
        val dash = 3.dp.toPx()
        drawCircle(
            color = accents.unknown,
            radius = r,
            center = rightChild,
            style = Stroke(
                width = stroke,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(dash, dash)),
            ),
        )
    }
}
