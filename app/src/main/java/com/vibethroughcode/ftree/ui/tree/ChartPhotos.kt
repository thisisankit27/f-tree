package com.vibethroughcode.ftree.ui.tree

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.data.PhotoStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/**
 * The faces currently on the chart.
 *
 * Coil draws the photographs everywhere else in the app, but the chart is one `Canvas` rather than
 * a composable per person, so there is nothing for an `AsyncImage` to be attached to. This is the
 * equivalent for a drawn surface: ask for the faces that are actually on screen, decode them off
 * the main thread, and hold them in snapshot state so that a face arriving re-runs the *draw*
 * phase and nothing else.
 *
 * Bounded twice over, which is what makes photographs affordable on a chart of a thousand people.
 * Only what the viewport can see is ever asked for, and what is held is capped at [LIMIT] faces
 * decoded to [EDGE_PX] in `RGB_565` — about fifty kilobytes each, so the worst case is a few
 * megabytes and the ordinary case, a screenful of cards, is a few hundred kilobytes.
 */
@Stable
class ChartPhotos(
    private val store: PhotoStore,
    private val scope: CoroutineScope,
) {
    private val images = mutableStateMapOf<String, ImageBitmap>()

    /** Photos whose file is gone or unreadable; asked for once, then left alone. */
    private val unreadable = mutableSetOf<String>()

    private var work: Job? = null

    /** Read from inside the draw lambda, so an arriving face invalidates the drawing only. */
    fun image(photoId: String?): ImageBitmap? = photoId?.let { images[it] }

    /**
     * Says which faces are on screen, in the order they should appear.
     *
     * Anything already held that is no longer wanted is dropped once the cap is reached, so panning
     * across a large family trades faces in and out rather than accumulating them.
     */
    fun request(photoIds: List<String>) {
        val wanted = photoIds.distinct().take(LIMIT)
        if (images.size > LIMIT) {
            val keep = wanted.toSet()
            images.keys.filterNot { it in keep }
                .take(images.size - LIMIT)
                .forEach { images.remove(it) }
        }

        val todo = wanted.filter { it !in images && it !in unreadable }
        if (todo.isEmpty()) return

        // One decode at a time, restarted as the viewport moves. Anything already decoded is kept,
        // so a cancelled pass costs at most the one face it was in the middle of.
        work?.cancel()
        work = scope.launch {
            todo.forEach { id ->
                val bitmap = store.thumbnail(id, EDGE_PX)
                if (bitmap == null) unreadable += id else images[id] = bitmap.asImageBitmap()
            }
        }
    }

    fun clear() {
        work?.cancel()
        work = null
        images.clear()
        unreadable.clear()
    }

    companion object {
        /**
         * Enough for a card at the deepest zoom without carrying a stored photograph's full 512px
         * into memory once per person.
         */
        const val EDGE_PX = 160
        const val LIMIT = 160
    }
}

/**
 * The chart's face cache, or nothing when the reader has turned photographs off.
 *
 * Returning null rather than an empty cache is deliberate: it makes "photos are off" a fact the
 * drawing code cannot forget to check, and it means a chart with the setting off does not open a
 * single file.
 */
@Composable
fun rememberChartPhotos(enabled: Boolean): ChartPhotos? {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val photos = remember(context) {
        ChartPhotos((context.applicationContext as FTreeApplication).container.photoStore, scope)
    }

    // Turning the setting off gives the memory back straight away rather than at the next
    // navigation, which is the whole point of somebody reaching for it on a large tree.
    LaunchedEffect(enabled) { if (!enabled) photos.clear() }

    return photos.takeIf { enabled }
}
