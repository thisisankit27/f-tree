package com.vibethroughcode.ftree.transfer

import android.content.Context
import java.util.UUID

/**
 * This installation's stable id.
 *
 * Generated once and never changed, so every export this device produces claims the same origin
 * and a re-import can recognise its own people with certainty rather than by comparing names.
 */
class TreeIdentity(context: Context) {

    private val preferences =
        context.applicationContext.getSharedPreferences("f-tree", Context.MODE_PRIVATE)

    val treeId: String
        get() = preferences.getString(KEY, null) ?: UUID.randomUUID().toString().also {
            preferences.edit().putString(KEY, it).apply()
        }

    private companion object {
        const val KEY = "source-tree-id"
    }
}
