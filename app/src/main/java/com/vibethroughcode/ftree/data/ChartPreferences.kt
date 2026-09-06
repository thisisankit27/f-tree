package com.vibethroughcode.ftree.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * How the chart is drawn, as the reader has asked for it.
 *
 * On by default, unlike the updater's switch. Nothing here leaves the device or costs anything the
 * reader has not already paid for — the photographs are theirs and already on the phone — so the
 * useful default is the one that shows them, and the switch is there for the tree large enough that
 * decoding faces while panning becomes noticeable.
 */
class ChartPreferences(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences("chart-preferences", Context.MODE_PRIVATE)

    private val _photosInChart = MutableStateFlow(prefs.getBoolean(KEY_PHOTOS, true))

    /** Whether the chart draws photographs, or only the coloured discs behind them. */
    val photosInChart: StateFlow<Boolean> = _photosInChart.asStateFlow()

    fun setPhotosInChart(value: Boolean) {
        prefs.edit().putBoolean(KEY_PHOTOS, value).apply()
        _photosInChart.value = value
    }

    private companion object {
        const val KEY_PHOTOS = "photos-in-chart"
    }
}
