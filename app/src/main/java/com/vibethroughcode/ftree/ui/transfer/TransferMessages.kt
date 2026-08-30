package com.vibethroughcode.ftree.ui.transfer

import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.res.stringResource
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
 *
 * The message is resolved during composition rather than inside the effect, so it follows the
 * current configuration — a language or locale change while the snackbar is up re-reads the right
 * string instead of showing a stale one.
 */
@Composable
fun TransferMessages(
    viewModel: TransferViewModel,
    snackbarHostState: SnackbarHostState = remember { SnackbarHostState() },
) {
    val outcome by viewModel.outcome.collectAsStateWithLifecycle()

    val message: String? = when (val current = outcome) {
        null -> null
        is TransferOutcome.Exported -> {
            val summary = current.summary
            if (summary.photos > 0) {
                stringResource(
                    R.string.export_done_photos,
                    summary.people,
                    summary.relationships,
                    summary.photos,
                )
            } else {
                stringResource(R.string.export_done, summary.people, summary.relationships)
            }
        }

        TransferOutcome.ExportFailed -> stringResource(R.string.export_failed)
    }

    LaunchedEffect(message) {
        if (message == null) return@LaunchedEffect
        snackbarHostState.showSnackbar(message = message, duration = SnackbarDuration.Long)
        viewModel.clearOutcome()
    }
}
