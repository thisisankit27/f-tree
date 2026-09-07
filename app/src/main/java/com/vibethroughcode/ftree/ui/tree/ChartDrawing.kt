package com.vibethroughcode.ftree.ui.tree

import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.sp
import com.vibethroughcode.ftree.data.PartialDate
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.graph.DescentLink
import com.vibethroughcode.ftree.graph.TreeMetrics
import com.vibethroughcode.ftree.ui.theme.FTreeText
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * The chart's notation, in one place.
 *
 * Both charts draw the same cards — the ego-centric one and the whole-tree one — and the notation
 * is the product's language, not a per-screen decision. A dashed brass edge means the same thing on
 * either, and it can only keep meaning the same thing if it is written once.
 */

/**
 * The part of the chart currently on screen, in layout units.
 *
 * Padded by a couple of cards so a node halfway off the edge is still drawn — and so that a face
 * is already decoded by the time panning brings it into view. Both charts cull against this and
 * ask for photographs against it, which is why it is written once rather than twice.
 */
internal fun visibleRegion(pan: Offset, zoom: Float, unitPx: Float, width: Float, height: Float): Rect =
    Rect(
        left = -pan.x / zoom / unitPx,
        top = -pan.y / zoom / unitPx,
        right = (width - pan.x) / zoom / unitPx,
        bottom = (height - pan.y) / zoom / unitPx,
    ).inflate(TreeMetrics.NODE_WIDTH * 2f)

internal fun visibleRegion(pan: Offset, zoom: Float, unitPx: Float, viewport: IntSize): Rect =
    visibleRegion(pan, zoom, unitPx, viewport.width.toFloat(), viewport.height.toFloat())

internal fun visibleRegion(pan: Offset, zoom: Float, unitPx: Float, viewport: Size): Rect =
    visibleRegion(pan, zoom, unitPx, viewport.width, viewport.height)

/**
 * One family's descent: out to the right of the parents, a bar down the children, and a stub into
 * each.
 *
 * The bar runs from the parents' stem to the far side of the children, rather than only between the
 * first child and the last. That is not a flourish: the parents' middle is regularly *outside* the
 * run of their own children — a couple whose eldest child has a large family of their own gets
 * pushed clear of the whole run — and a bar drawn only between the children then leaves the stem
 * ending in mid-air. The chart silently stops claiming the parentage it was drawn to state, and a
 * reader quite reasonably concludes those children have no recorded parents. It is one line of
 * arithmetic to draw the connector that was always meant to be there.
 *
 * Written once because both charts draw it, and a connector that means one thing on the focused
 * chart and another on the whole one is not notation.
 */
fun DrawScope.drawDescent(
    link: DescentLink,
    unitPx: Float,
    color: Color,
    strokeWidth: Float,
    alpha: Float = 1f,
) {
    val originY = link.originY * unitPx
    val busX = link.busX * unitPx
    val ys = link.childYs.map { it * unitPx }
    if (ys.isEmpty()) return

    drawLine(
        color = color,
        start = Offset(link.originX * unitPx, originY),
        end = Offset(busX, originY),
        strokeWidth = strokeWidth,
        alpha = alpha,
    )
    drawLine(
        color = color,
        start = Offset(busX, link.barStart * unitPx),
        end = Offset(busX, link.barEnd * unitPx),
        strokeWidth = strokeWidth,
        alpha = alpha,
    )
    ys.forEach { y ->
        drawLine(
            color = color,
            start = Offset(busX, y),
            end = Offset(link.childLeftX * unitPx, y),
            strokeWidth = strokeWidth,
            alpha = alpha,
        )
    }
}

/** How much of a card is drawn, which depends on how far out the chart is zoomed. */
enum class CardDetail {
    /** Shape only. At this distance names would be an unreadable wash; the outline still speaks. */
    SHAPE,
    NAME,
    NAME_AND_YEARS,
}

data class CardColors(
    val surface: Color,
    /** The ground for somebody no longer living. Both charts pass it; the card decides. */
    val deceasedSurface: Color,
    val onSurface: Color,
    val muted: Color,
    val outline: Color,
    val unknown: Color,
    /** The disc behind an initial when there is no photograph, and the initial written on it. */
    val avatarFill: Color,
    val avatarInk: Color,
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
    /** The person's photograph, already cut to a thumbnail. Null draws the initial instead. */
    photo: ImageBitmap? = null,
) {
    val path = Path().apply {
        addRoundRect(
            RoundRect(
                Rect(left, top, left + width, top + height),
                CornerRadius(cornerPx, cornerPx),
            )
        )
    }
    val departed = person.isNoLongerLiving
    drawPath(
        path = path,
        color = if (departed && !emphasised) colors.deceasedSurface else colors.surface,
        alpha = alpha,
    )

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
    if (departed) {
        val inset = cornerPx * 0.9f
        val y = top + rulePx * 1.7f
        drawLine(
            color = colors.muted,
            start = Offset(left + inset, y),
            end = Offset(left + width - inset, y),
            strokeWidth = rulePx * 1.8f,
            alpha = alpha,
        )
    }

    val radius = height * TreeMetrics.AVATAR_DIAMETER / 2f
    val centre = Offset(left + height * TreeMetrics.AVATAR_INSET + radius, top + height / 2f)
    drawAvatar(person, centre, radius, colors, detail, rulePx, alpha, photo, measurer)

    if (detail == CardDetail.SHAPE) return

    val textLeft = centre.x + radius + height * TreeMetrics.AVATAR_INSET
    val textWidth = (left + width - cornerPx * 0.8f - textLeft).toInt().coerceAtLeast(1)
    val name = person.name?.trim()?.takeIf { it.isNotEmpty() }
    val nameResult = measurer.measure(
        text = name ?: "Unknown",
        style = FTreeText.nodeName.copy(
            color = (if (name == null) colors.unknown else colors.onSurface).copy(alpha = alpha),
            textAlign = TextAlign.Start,
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
                    textAlign = TextAlign.Start,
                ),
                maxLines = 1,
                constraints = Constraints(maxWidth = textWidth),
            )
        }

    // Left-aligned against the avatar rather than centred in what is left over: with a disc at the
    // start of every card, a ragged left edge would make a row of siblings look misaligned.
    val block = nameResult.size.height + (yearsResult?.size?.height ?: 0)
    var y = top + max(0f, (height - block) / 2f)
    drawText(nameResult, topLeft = Offset(textLeft, y))
    y += nameResult.size.height
    yearsResult?.let { drawText(it, topLeft = Offset(textLeft, y)) }
}

/**
 * The disc at the start of a card.
 *
 * Always drawn, whether or not there is a photograph and whether or not photographs are switched
 * on, because it is the card's shape as much as its content: turning faces off must not make a
 * hundred and fifty people move.
 *
 * Without a photograph it carries the initial on a ground coloured by gender — enough for a row of
 * faceless cards to still read as people rather than as a wall of identical discs. Somebody whose
 * name was never recorded keeps the dashed brass ring they have everywhere else in the app, since
 * that is the notation for a gap in the record and it must not quietly become a grey circle here.
 */
private fun DrawScope.drawAvatar(
    person: Person,
    centre: Offset,
    radius: Float,
    colors: CardColors,
    detail: CardDetail,
    rulePx: Float,
    alpha: Float,
    photo: ImageBitmap?,
    measurer: TextMeasurer,
) {
    if (photo != null) {
        // Squared about the middle here rather than on the way to disk: a photograph that arrived
        // in an import was never framed by anybody, and cutting it permanently would throw away
        // what a later reader might want back.
        val edge = min(photo.width, photo.height)
        val diameter = (radius * 2f).roundToInt().coerceAtLeast(1)
        val topLeft = IntOffset((centre.x - radius).roundToInt(), (centre.y - radius).roundToInt())

        clipPath(Path().apply { addOval(Rect(centre, radius)) }) {
            drawImage(
                image = photo,
                srcOffset = IntOffset((photo.width - edge) / 2, (photo.height - edge) / 2),
                srcSize = IntSize(edge, edge),
                dstOffset = topLeft,
                dstSize = IntSize(diameter, diameter),
                alpha = alpha,
            )
        }
        drawCircle(
            color = colors.outline,
            radius = radius,
            center = centre,
            alpha = alpha,
            style = Stroke(width = rulePx * 0.8f),
        )
        return
    }

    if (person.isUnnamed) {
        drawCircle(
            color = colors.unknown,
            radius = radius,
            center = centre,
            alpha = alpha,
            style = Stroke(
                width = rulePx,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(rulePx * 2.5f, rulePx * 2f)),
            ),
        )
    } else {
        drawCircle(color = colors.avatarFill, radius = radius, center = centre, alpha = alpha)
    }

    if (detail == CardDetail.SHAPE) return

    val mark = if (person.isUnnamed) "?" else person.name!!.trim().first().uppercase()
    val measured = measurer.measure(
        text = mark,
        style = FTreeText.nodeName.copy(
            color = (if (person.isUnnamed) colors.unknown else colors.avatarInk).copy(alpha = alpha),
            fontSize = pxAsSp(radius * 0.95f),
        ),
        maxLines = 1,
    )
    drawText(
        measured,
        topLeft = Offset(
            centre.x - measured.size.width / 2f,
            centre.y - measured.size.height / 2f,
        ),
    )
}

/**
 * A size in canvas pixels expressed as sp.
 *
 * The reader's font scale is divided back out deliberately. Everywhere else in the app text grows
 * with that setting, but this one glyph has to fit inside a circle of a fixed size, and a letter
 * that grows past its disc reads as a bug rather than as an accommodation. The names on the card
 * still scale, and the cards grow to hold them.
 */
private fun DrawScope.pxAsSp(px: Float) = (px / (density * fontScale)).sp

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
