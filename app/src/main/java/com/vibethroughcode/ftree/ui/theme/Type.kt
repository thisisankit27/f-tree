package com.vibethroughcode.ftree.ui.theme

import androidx.compose.material3.Typography
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.sp
import com.vibethroughcode.ftree.R

/*
 * Three voices, each with one job.
 *
 * Names are the content of this app, so they are set in Literata — a text serif rather than a
 * display face, because a family register should read like a book, not a poster. Dates, years and
 * counts are set in JetBrains Mono: they are *records*, its figures are tabular so columns line up
 * down a list, and the shift in voice tells you at a glance which part of a row is a person and
 * which part is data. Everything else — buttons, fields, helper text — uses the system sans and
 * stays out of the way.
 *
 * Both files are variable fonts subset to Latin; see docs/fonts.md.
 */

private fun literata(weight: Int) = Font(
    R.font.literata,
    weight = FontWeight(weight),
    variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
)

private fun mono(weight: Int) = Font(
    R.font.jetbrains_mono,
    weight = FontWeight(weight),
    variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
)

val Literata = FontFamily(literata(400), literata(500), literata(600), literata(700))
val Mono = FontFamily(mono(400), mono(500))

/** Names, headings and anything that is a person rather than a fact about them. */
private fun name(size: Int, lineHeight: Int, weight: FontWeight, spacing: Double = 0.0) = TextStyle(
    fontFamily = Literata,
    fontWeight = weight,
    fontSize = size.sp,
    lineHeight = lineHeight.sp,
    letterSpacing = spacing.sp,
)

val FTreeTypography = Typography().let { default ->
    Typography(
        displayLarge = name(48, 56, FontWeight.W600, (-0.5)),
        displayMedium = name(38, 46, FontWeight.W600, (-0.4)),
        displaySmall = name(30, 38, FontWeight.W600, (-0.3)),
        headlineLarge = name(28, 36, FontWeight.W600, (-0.2)),
        headlineMedium = name(24, 32, FontWeight.W600, (-0.2)),
        headlineSmall = name(20, 28, FontWeight.W600),
        titleLarge = name(20, 28, FontWeight.W600),
        titleMedium = name(17, 24, FontWeight.W600),
        titleSmall = name(15, 20, FontWeight.W500),
        bodyLarge = default.bodyLarge,
        bodyMedium = default.bodyMedium,
        bodySmall = default.bodySmall,
        labelLarge = default.labelLarge,
        labelMedium = default.labelMedium,
        labelSmall = default.labelSmall,
    )
}

/**
 * Styles outside Material's scale.
 *
 * [record] is the mono voice for dates and counts. [sectionLabel] is the letterspaced rule label
 * that heads each group on the person screen, borrowed from the ruled headings of a paper
 * register.
 */
object FTreeText {
    val record = TextStyle(
        fontFamily = Mono,
        fontWeight = FontWeight.W400,
        fontSize = 13.sp,
        lineHeight = 18.sp,
        letterSpacing = 0.sp,
    )

    val recordSmall = record.copy(fontSize = 11.sp, lineHeight = 15.sp)

    val sectionLabel = TextStyle(
        fontFamily = Mono,
        fontWeight = FontWeight.W500,
        fontSize = 11.sp,
        lineHeight = 16.sp,
        letterSpacing = 1.6.sp,
    )

    /** Node labels in the chart, where space is tight and clipping must be predictable. */
    val nodeName = TextStyle(
        fontFamily = Literata,
        fontWeight = FontWeight.W600,
        fontSize = 13.sp,
        lineHeight = 16.sp,
    )

    val nodeYears = TextStyle(
        fontFamily = Mono,
        fontWeight = FontWeight.W400,
        fontSize = 10.sp,
        lineHeight = 13.sp,
    )

    val overflow = TextOverflow.Ellipsis
}
