package com.vibethroughcode.ftree.update

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * Whether the app is allowed to look for updates, and what it remembers about the last look.
 *
 * Off until switched on, deliberately. The app declares INTERNET only for this, and an app that
 * promises to keep everything on the device should not make its first network request on the
 * strength of a default nobody chose.
 */
class UpdatePreferences(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences("update-preferences", Context.MODE_PRIVATE)

    private val _enabled = MutableStateFlow(prefs.getBoolean(KEY_ENABLED, false))

    /** Observed by the settings screen and checked before any request is made. */
    val enabled: StateFlow<Boolean> = _enabled.asStateFlow()

    fun setEnabled(value: Boolean) {
        prefs.edit().putBoolean(KEY_ENABLED, value).apply()
        _enabled.value = value
        if (!value) {
            // Leaving a remembered result behind would let a stale banner outlive the setting.
            prefs.edit().remove(KEY_LAST_CHECKED).remove(KEY_SKIPPED).apply()
        }
    }

    var lastCheckedAt: Long
        get() = prefs.getLong(KEY_LAST_CHECKED, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_CHECKED, value).apply()

    /** A version the reader has dismissed; they are not asked about it again. */
    var skippedVersion: String?
        get() = prefs.getString(KEY_SKIPPED, null)
        set(value) = prefs.edit().putString(KEY_SKIPPED, value).apply()

    private companion object {
        const val KEY_ENABLED = "enabled"
        const val KEY_LAST_CHECKED = "last-checked"
        const val KEY_SKIPPED = "skipped-version"
    }
}
