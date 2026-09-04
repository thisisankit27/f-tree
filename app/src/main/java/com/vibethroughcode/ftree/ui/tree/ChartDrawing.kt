package com.vibethroughcode.ftree.ui.tree

import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import com.vibethroughcode.ftree.data.PartialDate
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.ui.theme.FTreeText
import kotlin.math.max

/**
 * The chart's notation, in one place.
 *
 * Both charts draw the same cards — the ego-centric one and the whole-tree one — and the notation
 * is the product's language, not a per-screen decision. A dashed brass edge means the same thing on
 * either, and it can only keep meaning the same thing if it is written once.
 */

/** How much of a card is drawn, which depends on how far out the chart is zoomed. */
enum class CardDetail {
    /** Shape only. At this distance names would be an unreadable wash; the outline still speaks. */
    SHAPE,
    NAME,
    NAME_AND_YEARS,
}

data class CardColors(
    val surface: Color,
    val onSurface: Color,
    val muted: Color,
    val outline: Color,
    val unknown: Color,
)

/**
 * One person.
 *
 * A person with no name gets a dashed edge in brass: the gap is in what the family remembers, not a
 * fault in the record, so it reads as open rather than broken. That holds at every zoom, which is
 * what lets the holes in an archive stay visible even when the chart is too small to read.
 */
fun DrawScope.drawPersonCard(
    person: Person,
    left: Float,
    top: Float,
    width: Float,
    height: Float,
    measurer: TextMeasurer,
    colors: CardColors,
    detail: CardDetail,
    cornerPx: Float,
    rulePx: Float,
    emphasised: Boolean = false,
    alpha: Float = 1f,
) {
    val path = Path().apply {
        addRoundRect(
            RoundRect(
                Rect(left, top, left + width, top + height),
                CornerRadius(cornerPx, cornerPx),
            )
        )
    }
    drawPath(path, colors.surface, alpha = alpha)

    drawPath(
        path = path,
        color = colors.outline,
        alpha = alpha,
        style = if (person.isUnnamed) {
            Stroke(
                width = rulePx,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(rulePx * 4, rulePx * 3)),
            )
        } else {
            Stroke(width = if (emphasised) rulePx * 1.8f else rulePx)
        },
    )

    /*
     * A memorial rule along the top edge for somebody no longer living.
     *
     * Deliberately not a dotted or dashed outline: a broken perimeter already means "name not
     * known", and one visual idea cannot carry two unrelated meanings on the same chart. It also
     * has to compose — a person can be unnamed *and* dead, and on this card that reads as a dashed
     * brass edge with a rule across the top, rather than two dash patterns fighting each other.
     *
     * Drawn before the text and outside the detail check, so it survives to the scale where cards
     * are plain shapes. At a distance the chart then still shows which generations have passed.
     */
    if (person.isNoLongerLiving) {
        val inset = cornerPx * 0.9f
        val y = top + rulePx * 1.6f
        drawLine(
            color = colors.muted,
            start = Offset(left + inset, y),
            end = Offset(left + width - inset, y),
            strokeWidth = rulePx * 1.6f,
            alpha = alpha,
        )
    }

    if (detail == CardDetail.SHAPE) return

    val textWidth = (width - cornerPx * 2).toInt().coerceAtLeast(1)
    val name = person.name?.trim()?.takeIf { it.isNotEmpty() }
    val nameResult = measurer.measure(
        text = name ?: "Unknown",
        style = FTreeText.nodeName.copy(
            color = (if (name == null) colors.unknown else colors.onSurface).copy(alpha = alpha),
            textAlign = TextAlign.Center,
        ),
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        constraints = Constraints(maxWidth = textWidth),
    )

    val yearsResult = person.lifespan()
        ?.takeIf { detail == CardDetail.NAME_AND_YEARS }
        ?.let {
            measurer.measure(
                text = it,
                style = FTreeText.nodeYears.copy(
                    color = colors.muted.copy(alpha = alpha),
                    textAlign = TextAlign.Center,
                ),
                maxLines = 1,
                constraints = Constraints(maxWidth = textWidth),
            )
        }

    val block = nameResult.size.height + (yearsResult?.size?.height ?: 0)
    var y = top + max(0f, (height - block) / 2f)
    drawText(nameResult, topLeft = Offset(left + (width - nameResult.size.width) / 2f, y))
    y += nameResult.size.height
    yearsResult?.let {
        drawText(it, topLeft = Offset(left + (width - it.size.width) / 2f, y))
    }
}

/** Years only — a card has room for a span, not a date. */
fun Person.lifespan(): String? {
    val born = PartialDate.parse(birthDate)?.year
    val died = PartialDate.parse(deathDate)?.year
    return when {
        born != null && died != null -> "$born–$died"
        born != null && deceased -> "$born–"
        born != null -> born.toString()
        died != null -> "–$died"
        else -> null
    }
}
