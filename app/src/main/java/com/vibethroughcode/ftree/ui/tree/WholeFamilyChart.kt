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
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
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
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.graph.TreeMetrics
import com.vibethroughcode.ftree.graph.WholeTreeLayout
import com.vibethroughcode.ftree.ui.theme.FTreeText
import com.vibethroughcode.ftree.ui.theme.FTreeTheme

const val WholeFamilyChartTag = "whole-family-chart"

/**
 * The whole archive on one canvas.
 *
 * The idea that makes this readable rather than a grey wash is semantic zoom. Drawing every name at
 * every scale would be illegible the moment a large family is on screen, so the chart draws less as
 * it pulls back: at a distance cards are plain shapes and what you read is the *shape* of the
 * family — how many generations, how wide each one got, and where the record has holes, because an
 * unknown person keeps their dashed brass edge at every scale.
 *
 * Like [FamilyChart], pan and zoom live in float state read only inside the draw lambda, so a drag
 * re-runs the draw phase and nothing else.
 */
@Composable
fun WholeFamilyChart(
    layout: WholeTreeLayout,
    onSelect: (Person) -> Unit,
    modifier: Modifier = Modifier,
    selectedId: String? = null,
    highlighted: Set<String> = emptySet(),
    /** True when [layout] holds one traced relation rather than the whole record. */
    tracing: Boolean = false,
) {
    val description = if (tracing) {
        stringResource(R.string.a11y_traced_chart, layout.nodes.size)
    } else {
        stringResource(R.string.a11y_whole_chart, layout.nodes.size, layout.unconnectedCount)
    }
    val density = LocalDensity.current
    val measurer = rememberTextMeasurer()
    val colors = MaterialTheme.colorScheme
    val accents = FTreeTheme.accents

    var zoom by remember { mutableFloatStateOf(1f) }
    var pan by remember { mutableStateOf(Offset.Zero) }
    var viewport by remember { mutableStateOf(IntSize.Zero) }

    // Labels are canvas text, so they are resolved here rather than inside the draw lambda.
    val familyLabel = stringResource(R.string.whole_group_family)
    val unconnectedLabel = stringResource(R.string.whole_group_unconnected)
    val groupLabels = remember(layout) {
        layout.groups.map { group ->
            if (group.unconnected) unconnectedLabel.format(group.memberCount)
            else familyLabel.format(group.memberCount, group.generations)
        }
    }

    /*
     * Opening framing.
     *
     * Fitting the whole archive is the right first sight of a family of forty. Past the point where
     * a card would be too small to carry a name it stops being a chart and becomes a texture, so
     * beyond that the view opens at a readable scale on the largest family instead.
     */
    LaunchedEffect(layout, viewport) {
        if (viewport == IntSize.Zero || layout.isEmpty) return@LaunchedEffect
        with(density) {
            val chartWidth = layout.width.dp.toPx()
            val chartHeight = layout.height.dp.toPx()
            val byWidth = viewport.width / chartWidth
            val byHeight = viewport.height / chartHeight
            val toFit = minOf(byWidth, byHeight, MAX_FIT)

            if (toFit >= LEGIBLE) {
                zoom = toFit
                pan = Offset(
                    (viewport.width - chartWidth * toFit) / 2f,
                    (viewport.height - chartHeight * toFit) / 2f,
                )
            } else {
                /*
                 * Too wide to fit and stay legible.
                 *
                 * Generations are the axis that carries the meaning, so all of them on screen with
                 * the width running off the side beats a whole chart too small to read. Panning
                 * sideways through a generation is how a family tree is read on paper anyway.
                 */
                zoom = minOf(byHeight, MAX_FIT).coerceAtLeast(LEGIBLE)
                val first = layout.groups.firstOrNull { !it.unconnected } ?: layout.groups.first()
                val inset = 16.dp.toPx()
                pan = Offset(
                    inset - first.x.dp.toPx() * zoom,
                    if (chartHeight * zoom <= viewport.height) {
                        (viewport.height - chartHeight * zoom) / 2f
                    } else {
                        inset - first.y.dp.toPx() * zoom
                    },
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
            .testTag(WholeFamilyChartTag)
            .semantics { contentDescription = description }
            .onSizeChanged { viewport = it }
            .pointerInput(Unit) {
                detectTransformGestures { centroid, panChange, zoomChange, _ ->
                    val next = (zoom * zoomChange).coerceIn(MIN_ZOOM, MAX_ZOOM)
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
        val detail = when {
            currentZoom < SHOW_NAMES -> CardDetail.SHAPE
            currentZoom < SHOW_YEARS -> CardDetail.NAME
            else -> CardDetail.NAME_AND_YEARS
        }
        /*
         * No frame labels while a line is traced. There is exactly one group and it is the answer,
         * so "3 people · 3 generations" restates the header directly above it — and, drawn above a
         * group that now sits at the very top of a small chart, collides with it.
         */
        val showLabels = currentZoom >= SHOW_LABELS && !tracing
        val dimming = highlighted.isNotEmpty()

        val visible = Rect(
            left = -currentPan.x / currentZoom / unitPx,
            top = -currentPan.y / currentZoom / unitPx,
            right = (size.width - currentPan.x) / currentZoom / unitPx,
            bottom = (size.height - currentPan.y) / currentZoom / unitPx,
        ).inflate(TreeMetrics.NODE_WIDTH * 2f)

        translate(currentPan.x, currentPan.y) {
            scale(currentZoom, currentZoom, Offset.Zero) {

                // Generation rules, faint, so the strata read even when the names cannot.
                layout.bands.forEach { band ->
                    val y = (band.y + TreeMetrics.NODE_HEIGHT / 2f) * unitPx
                    if (band.y < visible.top || band.y > visible.bottom) return@forEach
                    drawLine(
                        color = accents.rule.copy(alpha = 0.22f),
                        start = Offset(band.x * unitPx, y),
                        end = Offset((band.x + band.width) * unitPx, y),
                        strokeWidth = rulePx * 0.7f,
                    )
                }

                layout.groups.forEachIndexed { index, group ->
                    if (group.x > visible.right || group.x + group.width < visible.left ||
                        group.y > visible.bottom || group.y + group.height < visible.top
                    ) return@forEachIndexed

                    val frame = Path().apply {
                        addRoundRect(
                            RoundRect(
                                Rect(
                                    Offset(group.x * unitPx, group.y * unitPx),
                                    Size(group.width * unitPx, group.height * unitPx),
                                ),
                                CornerRadius(cornerPx * 1.6f, cornerPx * 1.6f),
                            )
                        )
                    }
                    drawPath(
                        path = frame,
                        color = if (group.unconnected) accents.unknown.copy(alpha = 0.5f)
                        else accents.rule.copy(alpha = 0.35f),
                        style = Stroke(
                            width = rulePx,
                            // The unconnected block is dashed like the people in it: what is
                            // missing is the connection, not the person.
                            pathEffect = if (group.unconnected) {
                                PathEffect.dashPathEffect(floatArrayOf(rulePx * 5, rulePx * 4))
                            } else null,
                        ),
                    )

                    if (showLabels) {
                        val label = measurer.measure(
                            text = groupLabels[index],
                            style = FTreeText.record.copy(
                                color = if (group.unconnected) accents.unknown
                                else colors.onSurfaceVariant,
                            ),
                            maxLines = 1,
                        )
                        drawText(
                            label,
                            topLeft = Offset(
                                group.x * unitPx,
                                group.y * unitPx - label.size.height - rulePx * 3,
                            ),
                        )
                    }
                }

                layout.descentLinks.forEach { link ->
                    if (link.busY < visible.top || link.originY > visible.bottom) return@forEach
                    val originX = link.originX * unitPx
                    val busY = link.busY * unitPx
                    val xs = link.childXs.map { it * unitPx }

                    drawLine(accents.rule, Offset(originX, link.originY * unitPx), Offset(originX, busY), rulePx)
                    if (xs.size > 1) {
                        drawLine(accents.rule, Offset(xs.first(), busY), Offset(xs.last(), busY), rulePx)
                    } else {
                        drawLine(accents.rule, Offset(originX, busY), Offset(xs.first(), busY), rulePx)
                    }
                    xs.forEach { x ->
                        drawLine(accents.rule, Offset(x, busY), Offset(x, link.childTopY * unitPx), rulePx)
                    }
                }

                // Siblings whose shared parents are unknown: bracketed above, dashed, because what
                // joins them is exactly the part nobody wrote down.
                layout.siblingBrackets.forEach { bracket ->
                    val lift = TreeMetrics.LEVEL_GAP * 0.22f
                    val top = (bracket.y - lift) * unitPx
                    val path = Path().apply {
                        moveTo(bracket.fromX * unitPx, bracket.y * unitPx)
                        lineTo(bracket.fromX * unitPx, top)
                        lineTo(bracket.toX * unitPx, top)
                        lineTo(bracket.toX * unitPx, bracket.y * unitPx)
                    }
                    drawPath(
                        path = path,
                        color = accents.rule,
                        style = Stroke(
                            width = rulePx,
                            pathEffect = PathEffect.dashPathEffect(floatArrayOf(rulePx * 4, rulePx * 3)),
                        ),
                    )
                }

                layout.spouseLinks.forEach { link ->
                    if (link.y < visible.top || link.y > visible.bottom) return@forEach
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
                    if (node.x + TreeMetrics.NODE_WIDTH < visible.left || node.x > visible.right ||
                        node.y + TreeMetrics.NODE_HEIGHT < visible.top || node.y > visible.bottom
                    ) return@forEach

                    val isSelected = node.person.id == selectedId
                    // Everyone a step away stays at full strength while the rest fade, which is
                    // what makes one person findable in a chart of hundreds.
                    val near = !dimming || node.person.id in highlighted
                    drawPersonCard(
                        person = node.person,
                        left = node.x * unitPx,
                        top = node.y * unitPx,
                        width = TreeMetrics.NODE_WIDTH * unitPx,
                        height = TreeMetrics.NODE_HEIGHT * unitPx,
                        measurer = measurer,
                        colors = CardColors(
                            deceasedSurface = accents.deceasedSurface,
                            surface = if (isSelected) colors.primaryContainer else colors.surface,
                            onSurface = if (isSelected) colors.onPrimaryContainer else colors.onSurface,
                            muted = colors.onSurfaceVariant,
                            outline = when {
                                isSelected -> colors.primary
                                node.person.isUnnamed -> accents.unknown
                                else -> accents.rule
                            },
                            unknown = accents.unknown,
                        ),
                        detail = detail,
                        cornerPx = cornerPx,
                        rulePx = rulePx,
                        emphasised = isSelected,
                        alpha = if (near) 1f else 0.3f,
                    )
                }
            }
        }
    }
}

/** Below this a card cannot carry a name, so the chart stops pretending and draws shapes. */
private const val SHOW_NAMES = 0.4f
private const val SHOW_YEARS = 0.66f
private const val SHOW_LABELS = 0.34f
/** The scale at which a card is still readable, used to decide whether fitting is worth it. */
private const val LEGIBLE = 0.62f
private const val MAX_FIT = 1.5f
private const val MIN_ZOOM = 0.08f
private const val MAX_ZOOM = 2.5f
