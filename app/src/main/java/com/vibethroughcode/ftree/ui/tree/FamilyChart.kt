package com.vibethroughcode.ftree.ui.tree

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.PartialDate
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.graph.TreeLayout
import com.vibethroughcode.ftree.graph.TreeMetrics
import com.vibethroughcode.ftree.graph.TreeNode
import com.vibethroughcode.ftree.ui.theme.FTreeText
import com.vibethroughcode.ftree.ui.theme.FTreeTheme
import kotlin.math.max

const val FamilyChartTag = "family-chart"

/**
 * The family chart.
 *
 * Everything is drawn into one `Canvas` rather than composed as a node per person: at a few hundred
 * people, a composable per node costs far more in layout and recomposition than the drawing does.
 *
 * Pan and zoom live in plain float state read *only inside the draw lambda*, so dragging re-runs
 * the draw phase and nothing else — no recomposition, no relayout, however large the family. Only
 * nodes intersecting the viewport are drawn, so an off-screen thousand cost a bounds check each.
 */
@Composable
fun FamilyChart(
    layout: TreeLayout,
    onSelect: (Person) -> Unit,
    modifier: Modifier = Modifier,
) {
    // Text painted onto a canvas is invisible to a screen reader, and giving every node its own
    // semantics would mean composing one per person on every pan. The chart therefore describes
    // itself and points at the fully accessible route to the same information: the people list,
    // where each person's page spells out every relationship as ordinary text.
    val chartDescription = stringResource(
        R.string.a11y_chart,
        layout.focusId?.let { id -> layout.node(id)?.person?.name } ?: stringResource(R.string.person_unknown),
        layout.nodes.size,
    )
    val density = LocalDensity.current
    val measurer = rememberTextMeasurer()
    val colors = MaterialTheme.colorScheme
    val accents = FTreeTheme.accents

    var zoom by remember { mutableFloatStateOf(1f) }
    var pan by remember { mutableStateOf(Offset.Zero) }
    var viewport by remember { mutableStateOf(IntSize.Zero) }

    // Framing, whenever the chart changes. Done as an effect, never during composition or draw,
    // so it cannot loop.
    //
    // A family that fits is shown whole, because seeing the shape of it is the point. Only when it
    // does not fit does the view fall back to centring the focused person, who is then the thing
    // you are most likely to be looking for.
    LaunchedEffect(layout.focusId, layout.nodes.size, viewport) {
        if (viewport == IntSize.Zero || layout.isEmpty) return@LaunchedEffect
        with(density) {
            val chartWidth = layout.width.dp.toPx()
            val chartHeight = layout.height.dp.toPx()
            val toFit = minOf(viewport.width / chartWidth, viewport.height / chartHeight, 1f)

            if (toFit >= MIN_ZOOM) {
                // Zooming out to show the whole family is the better opening move: the shape of it
                // is most of what the chart has to say, and anything closer can be pinched to.
                zoom = toFit
                pan = Offset(
                    x = (viewport.width - chartWidth * toFit) / 2f,
                    y = (viewport.height - chartHeight * toFit) / 2f,
                )
            } else {
                // Too large to shrink and stay legible, so open on the focused person instead.
                val focus = layout.focusId?.let { layout.node(it) } ?: return@LaunchedEffect
                zoom = 1f
                pan = Offset(
                    x = viewport.width / 2f - focus.centerX.dp.toPx(),
                    y = viewport.height / 2f - focus.centerY.dp.toPx(),
                )
            }
        }
    }

    val cornerPx = with(density) { 10.dp.toPx() }
    val rulePx = with(density) { 1.5.dp.toPx() }
    val spouseGapPx = with(density) { 2.dp.toPx() }
    val unitPx = with(density) { 1.dp.toPx() }

    Canvas(
        modifier = modifier
            .fillMaxSize()
            .testTag(FamilyChartTag)
            .semantics { contentDescription = chartDescription }
            .onSizeChanged { viewport = it }
            .pointerInput(Unit) {
                detectTransformGestures { centroid, panChange, zoomChange, _ ->
                    val next = (zoom * zoomChange).coerceIn(MIN_ZOOM, MAX_ZOOM)
                    // Scale about the pinch centre, so the chart grows around what the fingers
                    // are on rather than around the corner of the screen.
                    val factor = next / zoom
                    pan = (pan - centroid) * factor + centroid + panChange
                    zoom = next
                }
            }
            .pointerInput(layout) {
                detectTapGestures { tap ->
                    val x = (tap.x - pan.x) / zoom / unitPx
                    val y = (tap.y - pan.y) / zoom / unitPx
                    layout.nodeAt(x, y)?.let { onSelect(it.person) }
                }
            },
    ) {
        val currentZoom = zoom
        val currentPan = pan

        // In layout units, the region currently on screen, padded by a node so partially visible
        // cards are not clipped away.
        val visible = Rect(
            left = -currentPan.x / currentZoom / unitPx,
            top = -currentPan.y / currentZoom / unitPx,
            right = (size.width - currentPan.x) / currentZoom / unitPx,
            bottom = (size.height - currentPan.y) / currentZoom / unitPx,
        ).inflate(TreeMetrics.NODE_WIDTH * 2f)

        translate(currentPan.x, currentPan.y) {
            scale(currentZoom, currentZoom, Offset.Zero) {
                layout.descentLinks.forEach { link ->
                    val originX = link.originX * unitPx
                    val busY = link.busY * unitPx
                    val xs = link.childXs.map { it * unitPx }

                    drawLine(
                        accents.rule,
                        Offset(originX, link.originY * unitPx),
                        Offset(originX, busY),
                        rulePx,
                    )
                    if (xs.size > 1) {
                        drawLine(accents.rule, Offset(xs.first(), busY), Offset(xs.last(), busY), rulePx)
                    } else {
                        drawLine(accents.rule, Offset(originX, busY), Offset(xs.first(), busY), rulePx)
                    }
                    xs.forEach { x ->
                        drawLine(accents.rule, Offset(x, busY), Offset(x, link.childTopY * unitPx), rulePx)
                    }
                }

                // Marriage is the doubled rule, as on a drawn pedigree.
                layout.spouseLinks.forEach { link ->
                    val y = link.y * unitPx
                    listOf(-spouseGapPx, spouseGapPx).forEach { dy ->
                        drawLine(
                            color = accents.spouseLink,
                            start = Offset(link.fromX * unitPx, y + dy),
                            end = Offset(link.toX * unitPx, y + dy),
                            strokeWidth = rulePx,
                        )
                    }
                }

                layout.nodes.forEach { node ->
                    if (node.x + node.width < visible.left || node.x > visible.right ||
                        node.y + node.height < visible.top || node.y > visible.bottom
                    ) return@forEach

                    drawPersonNode(
                        node = node,
                        left = node.x * unitPx,
                        top = node.y * unitPx,
                        width = node.width * unitPx,
                        height = node.height * unitPx,
                        measurer = measurer,
                        surface = if (node.isFocus) colors.primaryContainer else colors.surface,
                        onSurface = if (node.isFocus) colors.onPrimaryContainer else colors.onSurface,
                        muted = colors.onSurfaceVariant,
                        outline = when {
                            node.isFocus -> colors.primary
                            node.person.isUnnamed -> accents.unknown
                            else -> accents.rule
                        },
                        unknownColor = accents.unknown,
                        cornerPx = cornerPx,
                        rulePx = rulePx,
                    )
                }
            }
        }
    }
}

private const val MIN_ZOOM = 0.35f
private const val MAX_ZOOM = 2.5f

private fun DrawScope.drawPersonNode(
    node: TreeNode,
    left: Float,
    top: Float,
    width: Float,
    height: Float,
    measurer: TextMeasurer,
    surface: Color,
    onSurface: Color,
    muted: Color,
    outline: Color,
    unknownColor: Color,
    cornerPx: Float,
    rulePx: Float,
) {
    val path = Path().apply {
        addRoundRect(
            RoundRect(
                Rect(left, top, left + width, top + height),
                CornerRadius(cornerPx, cornerPx),
            )
        )
    }
    drawPath(path, surface)

    // A person with no name gets a dashed edge: the gap is in what the family remembers, not a
    // fault in the record, so it should read as open rather than broken.
    drawPath(
        path = path,
        color = outline,
        style = if (node.person.isUnnamed) {
            Stroke(width = rulePx, pathEffect = PathEffect.dashPathEffect(floatArrayOf(rulePx * 4, rulePx * 3)))
        } else {
            Stroke(width = if (node.isFocus) rulePx * 1.8f else rulePx)
        },
    )

    val textWidth = (width - cornerPx * 2).toInt().coerceAtLeast(1)
    val name = node.person.name?.trim()?.takeIf { it.isNotEmpty() }
    val nameResult = measurer.measure(
        text = name ?: "Unknown",
        style = FTreeText.nodeName.copy(
            color = if (name == null) unknownColor else onSurface,
            textAlign = TextAlign.Center,
        ),
        maxLines = 2,
        overflow = TextOverflow.Ellipsis,
        constraints = Constraints(maxWidth = textWidth),
    )

    val yearsResult = node.person.lifespan()?.let {
        measurer.measure(
            text = it,
            style = FTreeText.nodeYears.copy(color = muted, textAlign = TextAlign.Center),
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

/** Years only — a node has room for a span, not a date. */
private fun Person.lifespan(): String? {
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
