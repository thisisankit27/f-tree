package com.vibethroughcode.ftree.ui.common

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Whether the window is short enough that horizontal chrome has to give way.
 *
 * Phrased as a question about the window rather than about the *orientation*, because that is what
 * actually matters: a tablet on its side has room for a bottom bar and a chart both, and a phone
 * held upright in a split screen has none. Rotating a phone is simply the common way to arrive here.
 *
 * The threshold is where a top bar, a mode switch, a bottom bar and their insets leave a chart less
 * than half the screen — the point at which the app is mostly showing the reader its own furniture.
 */
@Composable
fun isShortWindow(): Boolean {
    val height = LocalWindowInfo.current.containerSize.height
    return with(LocalDensity.current) { height.toDp() } < SHORT_WINDOW
}

private val SHORT_WINDOW = 500.dp

/**
 * Whether a navigation rail stands along the start edge of whatever is being laid out.
 *
 * Provided once by the app shell, which is the only thing that knows. A screen has no business
 * asking about the orientation to work this out — the rail appears for reasons of its own — and
 * it needs the answer because a column of reading matter is positioned relative to the edge it
 * sits beside, not relative to the glass.
 */
val LocalHasNavigationRail = staticCompositionLocalOf { false }

/**
 * Holds a column of reading matter to a sensible measure, against whatever edge it belongs to.
 *
 * A list of names stretched across a landscape phone puts the name at one edge of the screen and
 * the date at the other, with a hand's width of nothing between them — the eye loses the row on the
 * way across. Typographers have known the answer for five hundred years and it is not "wider": a
 * line has a comfortable length, and past it you add margins rather than words.
 *
 * Where the column *sits* is the other half of it, and the answer is not "the middle" whatever the
 * screen. Centred beside a navigation rail, a column leaves a band of nothing between the rail and
 * the first word, bounded by furniture on both sides — a gap that reads as a mistake rather than as
 * a margin, and one the eye keeps trying to fill. So the column anchors to the rail when there is
 * one and centres when there is not, which in both cases puts its start edge against the nearest
 * real edge.
 *
 * Applied to a whole screen rather than to its body: a top bar and a floating button laid out to
 * the full width, above a column that is not, leave a search icon and an "add" button stranded out
 * in the margin with nothing to line up against. One measure for the screen means everything on it
 * shares the same two edges.
 *
 * The charts are exempt, deliberately. They are pictures, not prose, and they want every pixel.
 */
@Composable
fun Modifier.readableMeasure(max: Dp = 560.dp): Modifier {
    val alignment =
        if (LocalHasNavigationRail.current) Alignment.Start else Alignment.CenterHorizontally
    return fillMaxWidth().wrapContentWidth(alignment).widthIn(max = max)
}
