package com.vibethroughcode.ftree.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import android.content.Context

/**
 * Which language the app names family relationships in.
 *
 * Deliberately *not* an app language. Translating the buttons and the settings screen is a separate
 * and much larger job, and a half-translated interface reads worse than an English one. What this
 * changes is the family vocabulary — the word for a relationship — which is where a language carries
 * meaning English cannot: [HINDI] has five words for the one English calls "uncle", and a family
 * that says मामा does not think "maternal uncle" and translate.
 */
enum class KinshipLanguage { ENGLISH, HINDI }

/**
 * The chosen family vocabulary, remembered.
 *
 * English by default, because it is the only one the whole app is written in and a first run should
 * not guess at somebody's family from their device locale.
 */
class KinshipPreferences(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences("kinship-preferences", Context.MODE_PRIVATE)

    private val _language = MutableStateFlow(read())

    val language: StateFlow<KinshipLanguage> = _language.asStateFlow()

    fun setLanguage(value: KinshipLanguage) {
        prefs.edit().putString(KEY_LANGUAGE, value.name).apply()
        _language.value = value
    }

    /**
     * Stored by name, never by ordinal — the same rule the database follows, so reordering the enum
     * can never silently change somebody's setting.
     */
    private fun read(): KinshipLanguage {
        val stored = prefs.getString(KEY_LANGUAGE, null) ?: return KinshipLanguage.ENGLISH
        return KinshipLanguage.entries.firstOrNull { it.name == stored } ?: KinshipLanguage.ENGLISH
    }

    private companion object {
        const val KEY_LANGUAGE = "language"
    }
}
