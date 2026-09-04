package com.vibethroughcode.ftree.ui.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

/*
 * Palette: deep forest ink and brass on a bone ground.
 *
 * A family register is a document meant to outlast the person keeping it, so the app reads as ink
 * on paper rather than as a bright utility. Forest green carries the identity (it is also the
 * launcher icon), and brass is reserved almost entirely for one job: marking what is *not* known.
 * Because unknown people are a feature here rather than an error, they get a warm accent instead
 * of the usual grey-out or red.
 */

private val Forest = Color(0xFF2A5138)
private val ForestDeep = Color(0xFF0C2417)
private val Sage = Color(0xFF8FC7A1)
private val SageContainer = Color(0xFFCDE6D5)

private val Brass = Color(0xFF8A6420)
private val BrassLight = Color(0xFFE3C38C)
private val BrassContainer = Color(0xFFF5DDB4)

private val Bone = Color(0xFFF7F6F1)
private val BoneRaised = Color(0xFFFFFFFF)
private val InkDark = Color(0xFF1A1C1A)

private val NightGround = Color(0xFF10150F)
private val NightRaised = Color(0xFF1A211A)
private val NightInk = Color(0xFFE0E4DD)

val FTreeLightColors = lightColorScheme(
    primary = Forest,
    onPrimary = Color.White,
    primaryContainer = SageContainer,
    onPrimaryContainer = ForestDeep,
    secondary = Color(0xFF4E6355),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFD1E8D8),
    onSecondaryContainer = Color(0xFF0B1F14),
    tertiary = Brass,
    onTertiary = Color.White,
    tertiaryContainer = BrassContainer,
    onTertiaryContainer = Color(0xFF2C1D00),
    error = Color(0xFF8F3B30),
    onError = Color.White,
    errorContainer = Color(0xFFFFDAD4),
    onErrorContainer = Color(0xFF3B0906),
    background = Bone,
    onBackground = InkDark,
    surface = Bone,
    onSurface = InkDark,
    surfaceVariant = Color(0xFFDDE5DC),
    onSurfaceVariant = Color(0xFF414942),
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = Color(0xFFFCFBF6),
    surfaceContainer = Color(0xFFF1F0EA),
    surfaceContainerHigh = Color(0xFFEBEAE4),
    surfaceContainerHighest = Color(0xFFE5E4DE),
    surfaceBright = BoneRaised,
    surfaceDim = Color(0xFFD9D8D2),
    outline = Color(0xFF717971),
    outlineVariant = Color(0xFFC1C9C0),
    inverseSurface = Color(0xFF2F312E),
    inverseOnSurface = Color(0xFFF1F1EC),
    inversePrimary = Sage,
    scrim = Color.Black,
)

val FTreeDarkColors = darkColorScheme(
    primary = Sage,
    onPrimary = Color(0xFF06371C),
    primaryContainer = Color(0xFF204F33),
    onPrimaryContainer = Color(0xFFABE4BC),
    secondary = Color(0xFFB6CCBB),
    onSecondary = Color(0xFF223529),
    secondaryContainer = Color(0xFF384B3E),
    onSecondaryContainer = Color(0xFFD2E8D7),
    tertiary = BrassLight,
    onTertiary = Color(0xFF422C00),
    tertiaryContainer = Color(0xFF5E4100),
    onTertiaryContainer = Color(0xFFFFDEA8),
    error = Color(0xFFFFB4A8),
    onError = Color(0xFF561410),
    errorContainer = Color(0xFF73281F),
    onErrorContainer = Color(0xFFFFDAD4),
    background = NightGround,
    onBackground = NightInk,
    surface = NightGround,
    onSurface = NightInk,
    surfaceVariant = Color(0xFF414942),
    onSurfaceVariant = Color(0xFFC1C9C0),
    surfaceContainerLowest = Color(0xFF0B100A),
    surfaceContainerLow = Color(0xFF181D17),
    surfaceContainer = NightRaised,
    surfaceContainerHigh = Color(0xFF262C25),
    surfaceContainerHighest = Color(0xFF313730),
    surfaceBright = Color(0xFF363B34),
    surfaceDim = NightGround,
    outline = Color(0xFF8B938A),
    outlineVariant = Color(0xFF414942),
    inverseSurface = NightInk,
    inverseOnSurface = Color(0xFF2F312E),
    inversePrimary = Forest,
    scrim = Color.Black,
)

/**
 * Colours the app needs that Material does not name.
 *
 * [unknown] marks a person whose details are not known, and [spouseLink] draws the doubled rule
 * between partners in the chart. Both are part of the chart's notation, so they live here rather
 * than being picked ad hoc at each call site.
 */
data class FTreeAccents(
    val unknown: Color,
    val unknownSurface: Color,
    val spouseLink: Color,
    val rule: Color,
    /**
     * The ground a card sits on for somebody no longer living.
     *
     * A *fill*, deliberately, and not a reduced opacity: the whole-tree chart already fades cards
     * to mean "not related to the person you selected", and one visual idea cannot carry two
     * meanings. Living people are on fresh raised paper, the departed a shade into the ground —
     * which is legible at a glance across a whole chart and still legible with the names too small
     * to read.
     */
    val deceasedSurface: Color,
)

val LightAccents = FTreeAccents(
    unknown = Brass,
    unknownSurface = Color(0xFFF7EEDC),
    spouseLink = Color(0xFF5E8C6D),
    rule = Color(0xFF9AA69B),
    deceasedSurface = Color(0xFFEAE8DE),
)

val DarkAccents = FTreeAccents(
    unknown = BrassLight,
    unknownSurface = Color(0xFF2C2618),
    spouseLink = Sage,
    rule = Color(0xFF5C665C),
    deceasedSurface = Color(0xFF11160F),
)
