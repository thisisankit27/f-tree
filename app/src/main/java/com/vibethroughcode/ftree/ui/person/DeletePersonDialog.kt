package com.vibethroughcode.ftree.ui.person

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
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
            Text(
                if (connected) {
                    stringResource(
                        R.string.delete_body_connected,
                        name?.takeIf { it.isNotBlank() } ?: stringResource(R.string.person_unknown),
                        relationshipCount,
                    )
                } else {
                    stringResource(R.string.delete_body_isolated)
                }
            )
        },
        confirmButton = {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (connected) {
                    DeleteChoice(
                        label = stringResource(R.string.delete_keep_shape),
                        detail = stringResource(R.string.delete_keep_shape_detail),
                        tag = DeleteKeepAsUnknownTag,
                        onClick = { onConfirm(DeletionMode.KEEP_AS_UNKNOWN) },
                    )
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
        dismissButton = {
            TextButton(onClick = onDismiss) { Text(stringResource(R.string.delete_cancel)) }
        },
    )
}

@Composable
private fun DeleteChoice(
    label: String,
    detail: String,
    tag: String,
    onClick: () -> Unit,
    destructive: Boolean = false,
) {
    TextButton(onClick = onClick, modifier = Modifier.testTag(tag)) {
        Column(modifier = Modifier.padding(vertical = 4.dp)) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelLarge,
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
}
