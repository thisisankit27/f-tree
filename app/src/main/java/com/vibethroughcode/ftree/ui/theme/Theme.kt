package com.vibethroughcode.ftree.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf

private val LocalAccents = staticCompositionLocalOf { LightAccents }

/**
 * The app's theme.
 *
 * Dynamic colour is deliberately not used. The forest-and-brass palette is doing real work — brass
 * means "not known" everywhere in the app, including in the chart's notation — and a wallpaper-derived
 * scheme would reassign those meanings to whatever colours happened to be on the user's home screen.
 */
@Composable
fun FTreeTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colors = if (darkTheme) FTreeDarkColors else FTreeLightColors
    val accents = if (darkTheme) DarkAccents else LightAccents

    CompositionLocalProvider(LocalAccents provides accents) {
        MaterialTheme(
            colorScheme = colors,
            typography = FTreeTypography,
            content = content,
        )
    }
}

/** Access to the colours Material does not name. */
object FTreeTheme {
    val accents: FTreeAccents
        @Composable @ReadOnlyComposable get() = LocalAccents.current
}
