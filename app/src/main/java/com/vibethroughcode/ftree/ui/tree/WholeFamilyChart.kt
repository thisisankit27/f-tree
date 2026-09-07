package com.vibethroughcode.ftree.ui.tree

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
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
import com.vibethroughcode.ftree.ui.common.avatarFor
import com.vibethroughcode.ftree.ui.theme.FTreeText
import com.vibethroughcode.ftree.ui.theme.FTreeTheme
import kotlinx.coroutines.flow.distinctUntilChanged

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
    /** A tap on the paper between the cards, which is how a selection is put down again. */
    onDeselect: () -> Unit = {},
    selectedId: String? = null,
    highlighted: Set<String> = emptySet(),
    /** True when [layout] holds one traced relation rather than the whole record. */
    tracing: Boolean = false,
    /** The face cache, or null when the reader has turned photographs off. */
    photos: ChartPhotos? = null,
    /** Bumped to re-frame the chart on the family, after the reader has panned away from it. */
    frameSignal: Int = 0,
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
    LaunchedEffect(layout, viewport, frameSignal) {
        if (viewport == IntSize.Zero || layout.isEmpty) return@LaunchedEffect
        with(density) {
            /*
             * A traced line is framed on the line, not on the record.
             *
             * The layout's own width and height are the room the whole chart was laid out in,
             * which for a handful of people on one line is mostly empty: framing on it puts four
             * cards in a corner and calls it centred. The cards themselves are the answer, so
             * their box is what gets fitted.
             */
            val margin = if (tracing) TRACE_MARGIN else 0f
            val left = if (tracing) layout.nodes.minOf { it.x } - margin else 0f
            val top = if (tracing) layout.nodes.minOf { it.y } - margin else 0f
            val chartWidth = when {
                tracing -> layout.nodes.maxOf { it.x + TreeMetrics.NODE_WIDTH } + margin - left
                else -> layout.width
            }.dp.toPx()
            val chartHeight = when {
                tracing -> layout.nodes.maxOf { it.y + TreeMetrics.NODE_HEIGHT } + margin - top
                else -> layout.height
            }.dp.toPx()
            val originX = left.dp.toPx()
            val originY = top.dp.toPx()
            val byWidth = viewport.width / chartWidth
            val byHeight = viewport.height / chartHeight
            val toFit = minOf(byWidth, byHeight, MAX_FIT)

            if (toFit >= LEGIBLE) {
                zoom = toFit
                pan = Offset(
                    (viewport.width - chartWidth * toFit) / 2f - originX * toFit,
                    (viewport.height - chartHeight * toFit) / 2f - originY * toFit,
                )
            } else {
                /*
                 * Too tall to fit and stay legible.
                 *
                 * Generations are the axis that carries the meaning, and here they run across, so
                 * all of them on screen with the people running off the bottom beats a whole chart
                 * too small to read. What is left over is then a scroll down a generation, which is
                 * the gesture a phone is for — and is the whole reason the chart was turned on its
                 * side. Before the rotation this branch fitted the other axis and left the reader
                 * panning sideways through sixty-four people.
                 */
                zoom = minOf(byWidth, MAX_FIT).coerceAtLeast(LEGIBLE)
                val inset = 16.dp.toPx()

                /*
                 * Opened on the family's origin rather than on the corner of its frame.
                 *
                 * A frame's top-left corner is not where anybody is. The earliest generation holds
                 * two or three people and the latest holds sixty, and every column is centred
                 * against its own descendants, so the oldest couple sit halfway down a chart whose
                 * first screenful is otherwise blank. Opening there showed a reader an empty page
                 * with a few faint generation rules on it. So: the earliest generation against the
                 * left edge, and that generation's own middle against the middle of the screen.
                 */
                val startX = if (tracing) originX else layout.nodes.minOf { it.x }.dp.toPx()
                val middleY = if (tracing) {
                    originY + chartHeight / 2f
                } else {
                    val firstColumn = layout.nodes.minOf { it.x }
                    val root = layout.nodes.filter { it.x <= firstColumn + 0.5f }
                    val top = root.minOf { it.y }
                    val bottom = root.maxOf { it.y } + TreeMetrics.NODE_HEIGHT
                    ((top + bottom) / 2f).dp.toPx()
                }
                pan = Offset(
                    if (chartWidth * zoom <= viewport.width) {
                        (viewport.width - chartWidth * zoom) / 2f - originX * zoom
                    } else {
                        inset - startX * zoom
                    },
                    viewport.height / 2f - middleY * zoom,
                )
            }
        }
    }

    val cornerPx = with(density) { 10.dp.toPx() }
    val rulePx = with(density) { 1.5.dp.toPx() }
    val spouseGapPx = with(density) { 2.dp.toPx() }
    val unitPx = with(density) { 1.dp.toPx() }

    /*
     * Which faces to decode: the ones on screen, and only when the chart is close enough in for a
     * card to be more than a shape. Pulled right back, a face would be a handful of pixels and
     * decoding four hundred of them would buy nothing the coloured discs do not already say.
     */
    val wantedPhotos = remember(layout, photos, unitPx) {
        derivedStateOf {
            if (photos == null || viewport == IntSize.Zero || zoom < SHOW_NAMES) emptyList() else {
                val region = visibleRegion(pan, zoom, unitPx, viewport)
                layout.nodes.asSequence()
                    .filter {
                        it.x + TreeMetrics.NODE_WIDTH >= region.left && it.x <= region.right &&
                            it.y + TreeMetrics.NODE_HEIGHT >= region.top && it.y <= region.bottom
                    }
                    .mapNotNull { it.person.photoId }
                    .toList()
            }
        }
    }
    LaunchedEffect(wantedPhotos, photos) {
        val cache = photos ?: return@LaunchedEffect
        snapshotFlow { wantedPhotos.value }.distinctUntilChanged().collect(cache::request)
    }

    val tapped by rememberUpdatedState(onSelect)
    val tappedNobody by rememberUpdatedState(onDeselect)

    Canvas(
        modifier = modifier
            .fillMaxSize()
            /*
             * A canvas does not clip its own drawing, so a chart panned past its top edge paints
             * over the header above it. Latent until the chart started opening centred on
             * something rather than tucked against a corner, at which point a generation of
             * cards appeared behind the title.
             */
            .clipToBounds()
            .testTag(WholeFamilyChartTag)
            .semantics { contentDescription = description }
            .onSizeChanged { viewport = it }
            .pointerInput(Unit) {
                detectTransformGestures { centroid, panChange, zoomChange, _ ->
                    val next = (zoom * zoomChange).coerceIn(MIN_ZOOM, MAX_ZOOM)
                    val factor = next / zoom
                    zoom = next
                    pan = clampPan(
                        pan = (pan - centroid) * factor + centroid + panChange,
                        contentWidth = layout.width * unitPx * next,
                        contentHeight = layout.height * unitPx * next,
                        viewport = viewport,
                    )
                }
            }
            .pointerInput(layout) {
                detectTapGestures { tap ->
                    val x = (tap.x - pan.x) / zoom / unitPx
                    val y = (tap.y - pan.y) / zoom / unitPx
                    // Through the latest callback, not the one this gesture block was built with.
                    // It is only restarted when the layout changes, so a tap handler that closes
                    // over screen state — what a tap should do while a relation is being asked —
                    // would otherwise go on doing what it meant several states ago.
                    // Tapping the paper puts the selection down. Without it the only way out of a
                    // dimmed chart is to select somebody else, which is not putting it down.
                    layout.nodeAt(x, y)?.let { tapped(it.person) } ?: tappedNobody()
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
        /*
         * Whose lines to light: the selected person's own, not the whole highlighted set.
         *
         * The set is the selection *and* everybody a step from it, which is the right answer for
         * cards and the wrong one for lines — lighting every connector belonging to every neighbour
         * would re-draw most of the lattice that dimming just took away.
         */
        val lit = selectedId?.takeIf { dimming }

        val visible = visibleRegion(currentPan, currentZoom, unitPx, size)

        translate(currentPan.x, currentPan.y) {
            scale(currentZoom, currentZoom, Offset.Zero) {

                // Generation rules, faint, so the strata read even when the names cannot. Down
                // the middle of each generation's column, since a generation is a column here.
                layout.bands.forEach { band ->
                    val x = (band.x + TreeMetrics.NODE_WIDTH / 2f) * unitPx
                    if (band.x < visible.left || band.x > visible.right) return@forEach
                    drawLine(
                        color = accents.rule.copy(alpha = 0.22f),
                        start = Offset(x, band.y * unitPx),
                        end = Offset(x, (band.y + band.height) * unitPx),
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
                        /*
                         * Normally the label sits on top of the frame, where it reads as a caption.
                         * When the frame is against the top of the viewport there is no "on top of"
                         * left — the label would be clipped, or printed over the header sitting
                         * directly above the canvas — so it drops inside the frame's own padding
                         * instead, where there is room by construction.
                         */
                        val above = group.y * unitPx - label.size.height - rulePx * 3
                        val room = above >= -currentPan.y / currentZoom
                        drawText(
                            label,
                            topLeft = if (room) {
                                Offset(group.x * unitPx, above)
                            } else {
                                Offset(group.x * unitPx + rulePx * 4, group.y * unitPx + rulePx * 3)
                            },
                        )
                    }
                }

                /*
                 * The connectors take part in the selection, rather than watching it happen.
                 *
                 * Fading the cards alone was the worst of both: a hundred and forty people dimmed
                 * and the entire lattice joining them left at full strength, so the one thing still
                 * competing for the eye was the thing the reader was trying to see past. The lines
                 * that run to the selected person are what *explain* the highlight — these are her
                 * parents, this is the marriage, those are the children — so they are drawn heavier
                 * and in the selection's own colour, and every other line recedes with the cards.
                 */
                layout.descentLinks.forEach { link ->
                    if (link.busX < visible.left || link.originX > visible.right) return@forEach
                    val on = lit != null && link.touches(lit)
                    drawDescent(
                        link = link,
                        unitPx = unitPx,
                        color = if (on) colors.primary else accents.rule,
                        strokeWidth = if (on) rulePx * 2f else rulePx,
                        alpha = if (!dimming || on) 1f else FADED,
                    )
                }

                // Siblings whose shared parents are unknown: bracketed above, dashed, because what
                // joins them is exactly the part nobody wrote down.
                layout.siblingBrackets.forEach { bracket ->
                    val lift = TreeMetrics.GENERATION_GAP * 0.22f
                    val back = (bracket.x - lift) * unitPx
                    val on = lit != null && bracket.touches(lit)
                    val path = Path().apply {
                        moveTo(bracket.x * unitPx, bracket.fromY * unitPx)
                        lineTo(back, bracket.fromY * unitPx)
                        lineTo(back, bracket.toY * unitPx)
                        lineTo(bracket.x * unitPx, bracket.toY * unitPx)
                    }
                    drawPath(
                        path = path,
                        color = if (on) colors.primary else accents.rule,
                        alpha = if (!dimming || on) 1f else FADED,
                        style = Stroke(
                            width = if (on) rulePx * 2f else rulePx,
                            pathEffect = PathEffect.dashPathEffect(floatArrayOf(rulePx * 4, rulePx * 3)),
                        ),
                    )
                }

                layout.spouseLinks.forEach { link ->
                    if (link.x < visible.left || link.x > visible.right) return@forEach
                    val x = link.x * unitPx
                    val on = lit != null && link.touches(lit)
                    listOf(-spouseGapPx, spouseGapPx).forEach { dx ->
                        drawLine(
                            // The doubled rule keeps its own colour when lit: widened and at full
                            // strength it is already the loudest thing in the column, and a
                            // marriage recoloured to match a selection stops reading as a marriage.
                            color = accents.spouseLink,
                            start = Offset(x + dx, link.fromY * unitPx),
                            end = Offset(x + dx, link.toY * unitPx),
                            strokeWidth = if (on) rulePx * 1.6f else rulePx,
                            alpha = if (!dimming || on) 1f else FADED,
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
                            avatarFill = accents.avatarFor(node.person.gender).fill,
                            avatarInk = accents.avatarFor(node.person.gender).ink,
                        ),
                        detail = detail,
                        cornerPx = cornerPx,
                        rulePx = rulePx,
                        emphasised = isSelected,
                        alpha = if (near) 1f else FADED,
                        photo = if (detail == CardDetail.SHAPE) null
                        else photos?.image(node.person.photoId),
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
/** What a card or a connector fades to when it is not part of the selection. */
private const val FADED = 0.28f

/** Air left around a traced line, in layout units, so the cards do not touch the edges. */
private const val TRACE_MARGIN = 12f

private const val LEGIBLE = 0.62f
private const val MAX_FIT = 1.5f
private const val MIN_ZOOM = 0.08f
private const val MAX_ZOOM = 2.5f
