package com.vibethroughcode.ftree.ui.person

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.DeletionMode
import com.vibethroughcode.ftree.ui.theme.FTreeTheme

const val DeleteKeepAsUnknownTag = "delete-keep-as-unknown"
const val DeleteCompletelyTag = "delete-completely"

/**
 * Asks what should happen to someone's connections, rather than asking whether the user is sure.
 *
 * When a person is joined to others, deleting them outright silently removes those links too, so
 * the alternative — keep the node, drop the details — is offered as an equal choice and stated in
 * terms of what happens to the family, not to the database.
 */
@Composable
fun DeletePersonDialog(
    name: String?,
    relationshipCount: Int,
    onDismiss: () -> Unit,
    onConfirm: (DeletionMode) -> Unit,
) {
    val connected = relationshipCount > 0
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                if (name.isNullOrBlank()) stringResource(R.string.delete_title_unknown)
                else stringResource(R.string.delete_title, name)
            )
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(
                    text = if (connected) {
                        stringResource(
                            R.string.delete_body_connected,
                            name?.takeIf { it.isNotBlank() } ?: stringResource(R.string.person_unknown),
                            relationshipCount,
                        )
                    } else {
                        stringResource(R.string.delete_body_isolated)
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(bottom = 8.dp),
                )

                if (connected) {
                    DeleteChoice(
                        label = stringResource(R.string.delete_keep_shape),
                        detail = stringResource(R.string.delete_keep_shape_detail),
                        tag = DeleteKeepAsUnknownTag,
                        onClick = { onConfirm(DeletionMode.KEEP_AS_UNKNOWN) },
                    )
                    HorizontalDivider(color = FTreeTheme.accents.rule)
                }
                DeleteChoice(
                    label = stringResource(R.string.delete_remove),
                    detail = if (connected) {
                        stringResource(R.string.delete_remove_detail, relationshipCount)
                    } else {
                        stringResource(R.string.delete_remove_detail_isolated)
                    },
                    tag = DeleteCompletelyTag,
                    destructive = true,
                    onClick = { onConfirm(DeletionMode.DELETE_COMPLETELY) },
                )
            }
        },
        // Nothing goes in the confirm slot. The two choices are the answer to the question and
        // belong under it, in the order they are read; leaving one of them here would put it
        // beside Cancel as though it were the expected outcome.
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.delete_cancel)) }
        },
    )
}

/**
 * One answer to "what happens to their connections", as a row rather than a button.
 *
 * Full width and divided from its neighbour, because these are two branches of one decision and a
 * pair of pill buttons would make the destructive one look like the ordinary one. The consequence
 * is printed under the label rather than left to the title, since that is the part somebody needs
 * before choosing and not after.
 */
@Composable
private fun DeleteChoice(
    label: String,
    detail: String,
    tag: String,
    onClick: () -> Unit,
    destructive: Boolean = false,
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 12.dp)
            .testTag(tag),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.titleSmall,
            color = if (destructive) MaterialTheme.colorScheme.error
            else MaterialTheme.colorScheme.primary,
        )
        Text(
            text = detail,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
