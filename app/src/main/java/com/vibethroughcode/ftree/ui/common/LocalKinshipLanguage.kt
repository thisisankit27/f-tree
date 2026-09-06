package com.vibethroughcode.ftree.ui.common

import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.staticCompositionLocalOf
import com.vibethroughcode.ftree.data.KinshipLanguage

/**
 * The family vocabulary in force, available to anything that names a relationship.
 *
 * A composition local rather than a parameter because the answer is needed in a dozen leaves — the
 * relation sentence, every section heading on a person's page, the chips on the add-relative screen —
 * and threading a language argument through every screen to reach them would put the setting in the
 * signature of code that has nothing else to do with it.
 *
 * Provided once, in `FTreeApp`.
 */
val LocalKinshipLanguage: ProvidableCompositionLocal<KinshipLanguage> =
    staticCompositionLocalOf { KinshipLanguage.ENGLISH }
