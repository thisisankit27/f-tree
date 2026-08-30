package com.vibethroughcode.ftree.debug

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.vibethroughcode.ftree.FTreeApplication
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Fills the tree with sample data, for development only.
 *
 * ```
 * adb shell am broadcast -a com.vibethroughcode.ftree.SEED \
 *     -n com.vibethroughcode.ftree/.debug.SeedReceiver --es mode family
 * adb shell am broadcast -a com.vibethroughcode.ftree.SEED \
 *     -n com.vibethroughcode.ftree/.debug.SeedReceiver --es mode large --ei size 2000
 * adb shell am broadcast -a com.vibethroughcode.ftree.SEED \
 *     -n com.vibethroughcode.ftree/.debug.SeedReceiver --es mode clear
 * ```
 */
class SeedReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val app = context.applicationContext as FTreeApplication
        val mode = intent.getStringExtra("mode") ?: "family"
        val size = intent.getIntExtra("size", 500)
        val pending = goAsync()

        CoroutineScope(Dispatchers.IO).launch {
            try {
                val seeder = SampleData(app.container.familyRepository, app.container.database)
                when (mode) {
                    "clear" -> seeder.clear()
                    "large" -> seeder.large(size)
                    else -> seeder.family()
                }
                Log.i("SeedReceiver", "seeded: $mode")
            } catch (e: Exception) {
                Log.e("SeedReceiver", "seeding failed", e)
            } finally {
                pending.finish()
            }
        }
    }
}
