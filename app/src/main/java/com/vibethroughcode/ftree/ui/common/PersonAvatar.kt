package com.vibethroughcode.ftree.ui.common

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import coil3.compose.AsyncImage
import com.vibethroughcode.ftree.data.PhotoStore
import java.io.File
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.ui.theme.FTreeTheme

/**
 * A person's mark in a list or on the chart.
 *
 * Someone whose name is not known gets a dashed brass ring rather than a greyed-out circle: an
 * unrecorded name is a gap in what the family remembers, not a failure state, and the dashes read
 * as "still open" rather than "broken".
 */
@Composable
fun PersonAvatar(
    person: Person,
    modifier: Modifier = Modifier,
    diameter: Dp = 40.dp,
) {
    val accents = FTreeTheme.accents
    val description = if (person.isUnnamed) {
        stringResource(R.string.a11y_unknown_avatar)
    } else {
        stringResource(R.string.a11y_person_avatar, person.name!!)
    }

    val photo = person.photoId
    if (photo != null) {
        // Coil decodes lazily and caches, so a long list of faces costs one decode each rather
        // than a bitmap per row held in memory.
        AsyncImage(
            model = LocalContext.current.photoFile(photo),
            contentDescription = description,
            contentScale = ContentScale.Crop,
            modifier = modifier
                .size(diameter)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surfaceContainerHigh),
        )
        return
    }

    if (person.isUnnamed) {
        Box(
            modifier = modifier
                .size(diameter)
                .drawBehind {
                    val stroke = 1.5.dp.toPx()
                    val dash = 3.dp.toPx()
                    drawCircle(
                        color = accents.unknown,
                        radius = (size.minDimension - stroke) / 2f,
                        style = Stroke(
                            width = stroke,
                            pathEffect = PathEffect.dashPathEffect(floatArrayOf(dash, dash)),
                        ),
                    )
                }
                .clearAndSetSemantics { contentDescription = description },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "?",
                color = accents.unknown,
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.titleMedium.copy(
                    fontSize = (diameter.value * 0.4f).sp,
                ),
            )
        }
    } else {
        Box(
            modifier = modifier
                .size(diameter)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primaryContainer)
                .clearAndSetSemantics { contentDescription = description },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = person.initial(),
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                textAlign = TextAlign.Center,
                style = MaterialTheme.typography.titleMedium.copy(
                    fontSize = (diameter.value * 0.4f).sp,
                ),
            )
        }
    }
}


/**
 * Resolves a stored photo id to a file.
 *
 * The database holds only the file name, so the path is rebuilt here rather than persisted —
 * which is what lets photos survive a reinstall or a restore onto another device.
 */
internal fun android.content.Context.photoFile(photoId: String): File =
    File(File(filesDir, PhotoStore.DIRECTORY), photoId)
