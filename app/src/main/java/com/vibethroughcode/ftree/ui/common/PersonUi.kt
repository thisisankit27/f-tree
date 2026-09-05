package com.vibethroughcode.ftree.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.PartialDate
import com.vibethroughcode.ftree.data.Person

/** The name to show, falling back to "Unknown" so a placeholder never renders as a blank row. */
@Composable
fun Person.displayName(): String =
    if (isUnnamed) stringResource(R.string.person_unknown) else name!!.trim()

/** First letter for the avatar; blank for someone unnamed. */
fun Person.initial(): String = name?.trim()?.firstOrNull()?.uppercase().orEmpty()

/**
 * The compact life span shown beside a name: `1938–2010`, `1938–`, `1990`, `Late`, or nothing.
 *
 * Only years, because that is the precision a list can show without becoming a table, and an
 * en dash because this is a span rather than a subtraction.
 *
 * [late] is the word for somebody known to have died with no date recorded. It is passed in rather
 * than read here so this stays usable off the main thread and out of a composable, and so the one
 * piece of user-facing English in it lives in the string resources with the rest.
 */
fun Person.lifespanLabel(late: String = "Late"): String? {
    val born = PartialDate.parse(birthDate)?.year
    val died = PartialDate.parse(deathDate)?.year
    return when {
        born != null && died != null -> "$born–$died"
        born != null && deceased -> "$born–"
        born != null -> born.toString()
        died != null -> "–$died"
        deceased -> late
        else -> null
    }
}
