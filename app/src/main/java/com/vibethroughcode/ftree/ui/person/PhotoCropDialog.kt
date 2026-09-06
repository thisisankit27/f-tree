package com.vibethroughcode.ftree.ui.person

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.SquareCrop
import kotlin.math.roundToInt

const val PhotoCropConfirmTag = "photo-crop-confirm"
const val PhotoCropCancelTag = "photo-crop-cancel"
const val PhotoCropAreaTag = "photo-crop-area"

/**
 * Framing a photograph in the circle it will be shown in.
 *
 * The window is fixed and the photograph moves behind it, rather than a rectangle being dragged
 * over a still picture. It is the same gesture as the charts — drag to move, pinch to zoom — and it
 * makes the awkward case impossible: the picture can never be smaller than the window, so there is
 * no way to frame a crescent of empty space and no error message needed to say so.
 *
 * The circle is the point. A face is drawn as a circle in every part of this app, so framing it as
 * a square and hoping would mean the reader choosing one thing and seeing another.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PhotoCropDialog(
    request: CropRequest,
    onCancel: () -> Unit,
    onConfirm: (SquareCrop) -> Unit,
) {
    Dialog(
        onDismissRequest = onCancel,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
        ),
    ) {
        Scaffold(
            modifier = Modifier.fillMaxSize(),
            topBar = {
                TopAppBar(
                    title = { Text(stringResource(R.string.photo_crop_title)) },
                    navigationIcon = {
                        IconButton(onClick = onCancel, modifier = Modifier.testTag(PhotoCropCancelTag)) {
                            Icon(
                                Icons.Default.Close,
                                contentDescription = stringResource(R.string.photo_crop_cancel),
                            )
                        }
                    },
                )
            },
        ) { padding ->
            Box(Modifier.fillMaxSize().padding(padding)) {
                when (request) {
                    CropRequest.Loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))

                    CropRequest.Unreadable -> Column(
                        modifier = Modifier.align(Alignment.Center).padding(32.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            stringResource(R.string.photo_crop_unreadable),
                            style = MaterialTheme.typography.bodyLarge,
                            textAlign = TextAlign.Center,
                        )
                        TextButton(onClick = onCancel, modifier = Modifier.padding(top = 12.dp)) {
                            Text(stringResource(R.string.photo_crop_cancel))
                        }
                    }

                    is CropRequest.Ready -> CropSurface(request, onConfirm)
                }
            }
        }
    }
}

@Composable
private fun CropSurface(request: CropRequest.Ready, onConfirm: (SquareCrop) -> Unit) {
    val image = remember(request) { request.bitmap.asImageBitmap() }
    val width = request.bitmap.width
    val height = request.bitmap.height

    val description = stringResource(R.string.a11y_crop_area)
    var viewport by remember { mutableStateOf(IntSize.Zero) }
    var zoom by remember { mutableFloatStateOf(1f) }
    var offset by remember { mutableStateOf(Offset.Zero) }

    val diameter = remember(viewport) {
        minOf(viewport.width, viewport.height) * CIRCLE_FRACTION
    }
    val baseScale = CircleCrop.baseScale(width, height, diameter)
    val scale = baseScale * zoom

    // The window can change size under the picture — a rotation, a split screen — and an offset
    // that was legal before might now put the circle over the edge of it.
    LaunchedEffect(viewport) {
        offset = clamp(offset, width, height, scale, diameter)
    }

    Column(Modifier.fillMaxSize()) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                // The photograph is drawn far larger than the window it is seen through — that is
                // the whole idea — so without this it spills over the rest of the screen.
                .clipToBounds()
                .testTag(PhotoCropAreaTag)
                .semantics { contentDescription = description }
                .onSizeChanged { viewport = it }
                .pointerInput(width, height, diameter) {
                    detectTransformGestures { _, panChange, zoomChange, _ ->
                        // Scaled about the circle's own centre, so the face under the window stays
                        // under it. A pinch centroid would be more literal and, with a window that
                        // never moves, more surprising.
                        val next = (zoom * zoomChange).coerceIn(1f, CircleCrop.MAX_ZOOM)
                        val factor = next / zoom
                        zoom = next
                        offset = clamp(
                            offset * factor + panChange,
                            width,
                            height,
                            baseScale * next,
                            diameter,
                        )
                    }
                },
        ) {
            Canvas(Modifier.fillMaxSize()) {
                if (diameter <= 0f) return@Canvas
                val centre = Offset(size.width / 2f, size.height / 2f)

                drawImage(
                    image = image,
                    dstOffset = IntOffset(
                        (centre.x + offset.x - width * scale / 2f).roundToInt(),
                        (centre.y + offset.y - height * scale / 2f).roundToInt(),
                    ),
                    dstSize = IntSize(
                        (width * scale).roundToInt().coerceAtLeast(1),
                        (height * scale).roundToInt().coerceAtLeast(1),
                    ),
                )

                // Everything outside the circle dimmed in one path with an even-odd fill: it is
                // one shape rather than four rectangles that have to agree with each other.
                val mask = Path().apply {
                    addRect(Rect(Offset.Zero, size))
                    addOval(Rect(centre, diameter / 2f))
                    fillType = PathFillType.EvenOdd
                }
                drawPath(mask, Color.Black.copy(alpha = 0.62f))
                drawCircle(
                    color = Color.White.copy(alpha = 0.85f),
                    radius = diameter / 2f,
                    center = centre,
                    style = Stroke(width = 1.5.dp.toPx()),
                )
            }
        }

        Text(
            text = stringResource(R.string.photo_crop_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 8.dp),
        )

        TextButton(
            onClick = {
                onConfirm(
                    CircleCrop.source(width, height, diameter, scale, offset.x, offset.y)
                )
            },
            modifier = Modifier
                .align(Alignment.CenterHorizontally)
                .padding(bottom = 24.dp)
                .testTag(PhotoCropConfirmTag),
        ) {
            Text(stringResource(R.string.photo_crop_use))
        }
    }
}

private fun clamp(
    offset: Offset,
    width: Int,
    height: Int,
    scale: Float,
    diameter: Float,
): Offset {
    val limitX = CircleCrop.offsetLimit(width, scale, diameter)
    val limitY = CircleCrop.offsetLimit(height, scale, diameter)
    return Offset(offset.x.coerceIn(-limitX, limitX), offset.y.coerceIn(-limitY, limitY))
}

/** Leaves a comfortable margin, so the picture outside the window is visible enough to aim with. */
private const val CIRCLE_FRACTION = 0.78f
