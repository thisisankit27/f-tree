package com.vibethroughcode.ftree.ui.common

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

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
 * The widest a single column of reading matter is allowed to get, and the narrowest worth having.
 *
 * A list of names stretched across a landscape phone puts the name at one edge and the date at the
 * other, with a hand's width of nothing between them — the eye loses the row on the way across.
 * Typographers have known the answer for five hundred years and it is not "wider".
 */
val READABLE_MEASURE = 560.dp
private val LEAST_MEASURE = 320.dp

/**
 * How many columns a pane this wide should be read in.
 *
 * The answer a typesetter gives to a page too wide for one column is *another column*, and this is
 * that answer: no column wider than the measure, as few columns as that allows, and the width
 * shared out between them so none of it is left over. A landscape phone reads in two, a tablet in
 * three, an upright phone in one — and in every case the content reaches both edges of the pane.
 *
 * The floor matters as much as the ceiling. Between one measure and two there is a stretch where
 * splitting would buy two columns too cramped to hold a name and a date, so a pane in that band
 * takes the extra width as a slightly long line rather than as a bad break. That is the only place
 * a column is allowed past [READABLE_MEASURE], and it tops out around the width of an upright
 * tablet, where one column is the right answer anyway.
 *
 * A pure function of a width rather than something that reads the window, because the pane is not
 * the window: a navigation rail and the display cutout beside it can take two hundred points off
 * the front before a screen sees any of it.
 */
fun readableColumns(
    width: Dp,
    measure: Dp = READABLE_MEASURE,
    least: Dp = LEAST_MEASURE,
): Int {
    if (width <= measure) return 1
    val fewestWithinTheMeasure = ceil(width / measure).toInt()
    val mostStillLegible = (width / least).toInt()
    return max(1, min(fewestWithinTheMeasure, mostStillLegible))
}

/**
 * Holds a column of reading matter to a sensible measure, centred in whatever it is given.
 *
 * This is for the screens that genuinely are one column and could not be any other number: a form
 * to fill in, a question to answer. Splitting a form into two columns makes the eye hunt for the
 * next field, so these take the measure and let the rest be margin, the way a page of a book does.
 *
 * Screens made of *parts* — a list of people, a stack of settings, a person's relatives — do not
 * use this. They use [readableColumns] and fill the pane. See `ReadingColumns`.
 */
fun Modifier.readableMeasure(max: Dp = READABLE_MEASURE): Modifier =
    fillMaxWidth().wrapContentWidth().widthIn(max = max)
