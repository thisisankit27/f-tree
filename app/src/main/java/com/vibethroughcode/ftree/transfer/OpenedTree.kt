package com.vibethroughcode.ftree.transfer

import android.content.Intent
import android.net.Uri
import androidx.core.content.IntentCompat

/**
 * The file another app has just handed to this one, if it handed one over at all.
 *
 * Two ways in, because they are two different gestures and both are things people do: tapping a
 * `.ftree` in a file manager or a chat app's downloads, which arrives as a VIEW, and choosing this
 * app from a share sheet, which arrives as a SEND with the file in an extra.
 *
 * What is deliberately *not* checked here is whether the file looks like a family tree. Providers
 * disagree about what a `.ftree` is — octet-stream, zip, or whatever a chat app stored it as — and
 * a name is not evidence in any case. The file is opened and read before anything is claimed about
 * it, and a file that turns out not to be one is refused with a sentence rather than filtered out
 * of the chooser on a guess.
 */
fun openedTree(intent: Intent?): Uri? = when (intent?.action) {
    Intent.ACTION_VIEW -> intent.data
    // Through IntentCompat rather than the typed overload, which is API 33 and this app runs from
    // 26. The old phone in a family is exactly the one somebody is trying to get a tree onto.
    Intent.ACTION_SEND -> IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
    else -> null
}
