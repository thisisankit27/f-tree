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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.graph.TreeLayout
import com.vibethroughcode.ftree.graph.TreeMetrics
import com.vibethroughcode.ftree.ui.common.avatarFor
import com.vibethroughcode.ftree.ui.theme.FTreeText
import com.vibethroughcode.ftree.ui.theme.FTreeTheme
import kotlinx.coroutines.flow.distinctUntilChanged

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
    /** The face cache, or null when the reader has turned photographs off. */
    photos: ChartPhotos? = null,
    /** Bumped to re-frame the chart on the family, after the reader has panned away from it. */
    frameSignal: Int = 0,
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
    LaunchedEffect(layout.focusId, layout.nodes.size, viewport, frameSignal) {
        if (viewport == IntSize.Zero || layout.isEmpty) return@LaunchedEffect
        with(density) {
            val chartWidth = layout.width.dp.toPx()
            val chartHeight = layout.height.dp.toPx()
            val toFit = minOf(viewport.width / chartWidth, viewport.height / chartHeight, MAX_FIT_ZOOM)

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

    /*
     * Which faces to decode: the ones on screen, and only those.
     *
     * Derived state read from a flow rather than from composition, so panning across a family
     * recomputes this list and nothing recomposes. Without that, every face on a chart of a
     * thousand would have to be decoded before the first one could be drawn.
     */
    val wantedPhotos = remember(layout, photos, unitPx) {
        derivedStateOf {
            if (photos == null || viewport == IntSize.Zero) emptyList() else {
                val region = visibleRegion(pan, zoom, unitPx, viewport)
                layout.nodes.asSequence()
                    .filter { it.x + it.width >= region.left && it.x <= region.right &&
                        it.y + it.height >= region.top && it.y <= region.bottom }
                    .mapNotNull { it.person.photoId }
                    .toList()
            }
        }
    }
    LaunchedEffect(wantedPhotos, photos) {
        val cache = photos ?: return@LaunchedEffect
        snapshotFlow { wantedPhotos.value }.distinctUntilChanged().collect(cache::request)
    }

    /**
     * How big the drawing is, kept current.
     *
     * Read by the gesture below, which is built once and would otherwise go on clamping against
     * whatever family happened to be on screen when it was made.
     */
    val paper by rememberUpdatedState(Size(layout.width, layout.height))

    /** Where the cards actually are, a generation at a time. Recomputed only when the chart is. */
    val columns = remember(layout) {
        layout.nodes.groupBy { it.x }.map { (x, ns) ->
            ChartColumn(
                left = x,
                right = x + ns.maxOf { it.width },
                top = ns.minOf { it.y },
                bottom = ns.maxOf { it.y + it.height },
            )
        }
    }
    val paperColumns by rememberUpdatedState(columns)

    val tapped by rememberUpdatedState(onSelect)

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
            .testTag(FamilyChartTag)
            .semantics { contentDescription = chartDescription }
            .onSizeChanged { viewport = it }
            /*
             * Keyed on nothing, so it is built once and never again — which is exactly why the
             * size it clamps against is read from [paper] rather than from `layout`. A gesture
             * block closing over the layout keeps the *first* one it ever saw: re-centre the chart
             * on somebody else and the pan is still being held inside the extent of a family that
             * is no longer on screen. The first drag then snaps the chart into that stale window
             * and most of the real one becomes unreachable.
             *
             * This is the same trap as the tap handler below, which reads the latest callback for
             * the same reason. A `pointerInput` key covers what restarts the gesture, never what
             * the gesture reads.
             */
            .pointerInput(Unit) {
                detectTransformGestures { centroid, panChange, zoomChange, _ ->
                    val next = (zoom * zoomChange).coerceIn(MIN_ZOOM, MAX_ZOOM)
                    // Scale about the pinch centre, so the chart grows around what the fingers
                    // are on rather than around the corner of the screen.
                    val factor = next / zoom
                    zoom = next
                    pan = clampPan(
                        pan = (pan - centroid) * factor + centroid + panChange,
                        contentWidth = paper.width * unitPx * next,
                        contentHeight = paper.height * unitPx * next,
                        viewport = viewport,
                        columns = paperColumns,
                        scale = unitPx * next,
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
                    layout.nodeAt(x, y)?.let { tapped(it.person) }
                }
            },
    ) {
        val currentZoom = zoom
        val currentPan = pan

        // In layout units, the region currently on screen, padded by a node so partially visible
        // cards are not clipped away.
        val visible = visibleRegion(currentPan, currentZoom, unitPx, size)

        translate(currentPan.x, currentPan.y) {
            scale(currentZoom, currentZoom, Offset.Zero) {
                layout.descentLinks.forEach { link ->
                    drawDescent(link, unitPx, accents.rule, rulePx)
                }

                // Marriage is the doubled rule, as on a drawn pedigree — down the side of the
                // couple, since a generation is a column and the two are stacked.
                layout.spouseLinks.forEach { link ->
                    val x = link.x * unitPx
                    listOf(-spouseGapPx, spouseGapPx).forEach { dx ->
                        drawLine(
                            color = accents.spouseLink,
                            start = Offset(x + dx, link.fromY * unitPx),
                            end = Offset(x + dx, link.toY * unitPx),
                            strokeWidth = rulePx,
                        )
                    }
                }

                layout.nodes.forEach { node ->
                    if (node.x + node.width < visible.left || node.x > visible.right ||
                        node.y + node.height < visible.top || node.y > visible.bottom
                    ) return@forEach

                    drawPersonCard(
                        person = node.person,
                        left = node.x * unitPx,
                        top = node.y * unitPx,
                        width = node.width * unitPx,
                        height = node.height * unitPx,
                        measurer = measurer,
                        colors = CardColors(
                            deceasedSurface = accents.deceasedSurface,
                            surface = if (node.isFocus) colors.primaryContainer else colors.surface,
                            onSurface = if (node.isFocus) colors.onPrimaryContainer else colors.onSurface,
                            muted = colors.onSurfaceVariant,
                            outline = when {
                                node.isFocus -> colors.primary
                                node.person.isUnnamed -> accents.unknown
                                else -> accents.rule
                            },
                            unknown = accents.unknown,
                            avatarFill = accents.avatarFor(node.person.gender).fill,
                            avatarInk = accents.avatarFor(node.person.gender).ink,
                        ),
                        detail = CardDetail.NAME_AND_YEARS,
                        cornerPx = cornerPx,
                        rulePx = rulePx,
                        emphasised = node.isFocus,
                        photo = photos?.image(node.person.photoId),
                    )
                }
            }
        }
    }
}

/** A small family may be scaled up to fill the screen, but only so far before it looks absurd. */
private const val MAX_FIT_ZOOM = 1.7f
private const val MIN_ZOOM = 0.35f
private const val MAX_ZOOM = 2.5f
