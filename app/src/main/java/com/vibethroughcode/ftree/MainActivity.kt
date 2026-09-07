package com.vibethroughcode.ftree

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.vibethroughcode.ftree.transfer.openedTree
import com.vibethroughcode.ftree.ui.FTreeApp
import com.vibethroughcode.ftree.ui.theme.FTreeTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class MainActivity : ComponentActivity() {

    /**
     * A file handed to the app from outside, waiting to be looked at.
     *
     * Held here rather than read from the intent where it is needed, because an intent is delivered
     * once but a composition happens many times: reading it directly would re-open the same file on
     * every rotation, throwing away whatever the reader had decided about the import so far.
     */
    private val opened = MutableStateFlow<Uri?>(null)

    /** Read-only, and made once: a flow built inside the composition would be a new one each time. */
    private val openedFile: StateFlow<Uri?> = opened.asStateFlow()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // Only on a fresh start. A recreated activity is handed the same intent again, and that is
        // the app being rebuilt, not somebody opening a file a second time.
        if (savedInstanceState == null) opened.value = openedTree(intent)
        setContent {
            FTreeTheme {
                FTreeApp(opened = openedFile, onOpened = { opened.value = null })
            }
        }
    }

    /** The app was already running when the file was opened. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        opened.value = openedTree(intent)
    }
}
