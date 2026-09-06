package com.vibethroughcode.ftree.ui.common

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.runtime.Composable
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
 * Holds a column of reading matter to a sensible measure, centred in whatever is left.
 *
 * A list of names stretched across a landscape phone puts the name at one edge of the screen and
 * the date at the other, with a hand's width of nothing between them — the eye loses the row on the
 * way across. Typographers have known the answer for five hundred years and it is not "wider": a
 * line has a comfortable length, and past it you add margins rather than words.
 *
 * The charts are exempt, deliberately. They are pictures, not prose, and they want every pixel.
 */
fun Modifier.readableMeasure(max: Dp = 560.dp): Modifier =
    fillMaxWidth().wrapContentWidth(Alignment.CenterHorizontally).widthIn(max = max)
