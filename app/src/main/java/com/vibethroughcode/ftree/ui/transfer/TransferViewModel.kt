package com.vibethroughcode.ftree.ui.transfer

import android.content.ContentResolver
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vibethroughcode.ftree.transfer.ExportSummary
import com.vibethroughcode.ftree.transfer.TreeExporter
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What just happened, for the message shown to the user. */
sealed interface TransferOutcome {
    data class Exported(val summary: ExportSummary) : TransferOutcome
    data object ExportFailed : TransferOutcome
}

class TransferViewModel(
    private val exporter: TreeExporter,
    private val contentResolver: ContentResolver,
) : ViewModel() {

    private val _outcome = MutableStateFlow<TransferOutcome?>(null)
    val outcome: StateFlow<TransferOutcome?> = _outcome.asStateFlow()

    private val _busy = MutableStateFlow(false)
    val busy: StateFlow<Boolean> = _busy.asStateFlow()

    fun export(destination: Uri) {
        viewModelScope.launch {
            _busy.value = true
            _outcome.value = runCatching {
                contentResolver.openOutputStream(destination)?.use { exporter.exportTo(it) }
            }.fold(
                onSuccess = { summary ->
                    if (summary == null) TransferOutcome.ExportFailed
                    else TransferOutcome.Exported(summary)
                },
                // The user picked the destination, so a failure here is a storage problem rather
                // than anything about their tree; say so plainly and leave the data untouched.
                onFailure = { TransferOutcome.ExportFailed },
            )
            _busy.value = false
        }
    }

    fun clearOutcome() { _outcome.value = null }
}
