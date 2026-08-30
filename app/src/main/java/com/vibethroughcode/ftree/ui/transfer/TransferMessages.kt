package com.vibethroughcode.ftree.ui.transfer

import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vibethroughcode.ftree.R
import java.time.LocalDate

/**
 * A sensible file name, so the export lands in the user's files as something recognisable rather
 * than as `document.zip`.
 */
fun defaultExportName(today: LocalDate = LocalDate.now()): String = "family-tree-$today.ftree"

/**
 * Reports the result of an export.
 *
 * Success is stated in terms of what was written, because "exported" alone gives no way to tell a
 * complete file from an empty one.
 */
@Composable
fun TransferMessages(
    viewModel: TransferViewModel,
    snackbarHostState: SnackbarHostState = remember { SnackbarHostState() },
) {
    val outcome by viewModel.outcome.collectAsStateWithLifecycle()
    val context = LocalContext.current

    LaunchedEffect(outcome) {
        val current = outcome ?: return@LaunchedEffect
        val message = when (current) {
            is TransferOutcome.Exported -> {
                val summary = current.summary
                if (summary.photos > 0) {
                    context.getString(
                        R.string.export_done_photos,
                        summary.people,
                        summary.relationships,
                        summary.photos,
                    )
                } else {
                    context.getString(R.string.export_done, summary.people, summary.relationships)
                }
            }

            TransferOutcome.ExportFailed -> context.getString(R.string.export_failed)
        }
        snackbarHostState.showMessage(message)
        viewModel.clearOutcome()
    }
}

private suspend fun SnackbarHostState.showMessage(message: String) {
    showSnackbar(message = message, duration = SnackbarDuration.Long)
}
