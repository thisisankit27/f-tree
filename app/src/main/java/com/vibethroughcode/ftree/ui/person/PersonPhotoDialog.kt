package com.vibethroughcode.ftree.ui.person

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import coil3.compose.AsyncImage
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.data.PhotoStore
import com.vibethroughcode.ftree.ui.common.displayName
import com.vibethroughcode.ftree.ui.common.photoFile

const val PersonPhotoDialogTag = "person-photo-dialog"
const val PersonPhotoCloseTag = "person-photo-close"
const val PersonPhotoImageTag = "person-photo-image"

/**
 * Somebody's photograph, as large as the screen will show it.
 *
 * Everywhere else in the app a face is a circle — in a list row, on a person's page, on a chart
 * card — because a circle is what a face has to be when it sits beside a name. That is a decision
 * about *display*, though, and the file on disk was never round: it is the square the reader framed,
 * or, for a photograph that arrived in somebody else's tree, the whole picture exactly as they sent
 * it. So this shows the picture whole and uncropped, which for an imported photograph is generally
 * more than any circle in the app has ever shown of it.
 *
 * Deliberately without pinch and zoom. A photograph is stored at [PhotoStore.STORED_EDGE] on its
 * long edge — small on purpose, so that a family of a thousand costs tens of megabytes and a
 * `.ftree` file is something you can send in a chat — and there is nothing underneath that size to
 * zoom into. Offering the gesture would promise detail the file does not contain.
 */
@Composable
fun PersonPhotoDialog(person: Person, onDismiss: () -> Unit) {
    val photoId = person.photoId ?: return
    val description = stringResource(R.string.a11y_person_avatar, person.displayName())

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            // Fills the screen properly rather than leaving the scrim short of the status and
            // navigation bars, which on a dark ground reads as a bug rather than as a frame.
            decorFitsSystemWindows = false,
        ),
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.94f))
                /*
                 * A tap anywhere puts it away, which is what a picture opened full screen has
                 * meant for as long as phones have had pictures. No ripple: this is a way out,
                 * not a control, and a flash of ink across a photograph looks like a fault.
                 */
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onDismiss,
                )
                .testTag(PersonPhotoDialogTag),
            contentAlignment = Alignment.Center,
        ) {
            AsyncImage(
                model = LocalContext.current.photoFile(photoId),
                contentDescription = description,
                // Fit, not Crop: the point of opening it is to see the parts a circle cuts off.
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxSize()
                    .safeDrawingPadding()
                    .padding(16.dp)
                    .testTag(PersonPhotoImageTag),
            )

            IconButton(
                onClick = onDismiss,
                colors = IconButtonDefaults.iconButtonColors(contentColor = Color.White),
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .safeDrawingPadding()
                    .padding(8.dp)
                    .testTag(PersonPhotoCloseTag),
            ) {
                Icon(Icons.Default.Close, contentDescription = stringResource(R.string.photo_close))
            }
        }
    }
}
