package com.vibethroughcode.ftree.ui.transfer

import android.content.ContentResolver
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vibethroughcode.ftree.transfer.ExportSummary
import com.vibethroughcode.ftree.transfer.ImportFailure
import com.vibethroughcode.ftree.transfer.ImportPlan
import com.vibethroughcode.ftree.transfer.ImportProblem
import com.vibethroughcode.ftree.transfer.ImportResult
import com.vibethroughcode.ftree.transfer.TreeExporter
import com.vibethroughcode.ftree.transfer.TreeImporter
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** What just happened, for the message shown to the user. */
sealed interface TransferOutcome {
    data class Exported(val summary: ExportSummary) : TransferOutcome
    data object ExportFailed : TransferOutcome
    data class Imported(val result: ImportResult) : TransferOutcome
    data class ImportFailed(val problem: ImportProblem) : TransferOutcome
}

class TransferViewModel(
    private val exporter: TreeExporter,
    private val importer: TreeImporter,
    private val contentResolver: ContentResolver,
) : ViewModel() {

    /**
     * The proposal awaiting the user's decision.
     *
     * Nothing is written while this is non-null; the plan describes what an import *would* do and
     * is thrown away untouched if the user backs out.
     */
    private val _plan = MutableStateFlow<ImportPlan?>(null)
    val plan: StateFlow<ImportPlan?> = _plan.asStateFlow()

    private val _decisions = MutableStateFlow<Map<String, Boolean>>(emptyMap())
    val decisions: StateFlow<Map<String, Boolean>> = _decisions.asStateFlow()

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

    /** Reads a chosen file and works out what importing it would do. Writes nothing. */
    fun prepareImport(source: Uri) {
        viewModelScope.launch {
            _busy.value = true
            runCatching {
                contentResolver.openInputStream(source)?.use { importer.prepare(it) }
                    ?: throw ImportFailure(ImportProblem.UNREADABLE)
            }.onSuccess { prepared ->
                _decisions.value = prepared.defaultDecisions
                _plan.value = prepared
            }.onFailure { failure ->
                _outcome.value = TransferOutcome.ImportFailed(
                    (failure as? ImportFailure)?.problem ?: ImportProblem.UNREADABLE
                )
            }
            _busy.value = false
        }
    }

    fun setDecision(importedId: String, merge: Boolean) {
        _decisions.value = _decisions.value + (importedId to merge)
    }

    fun confirmImport() {
        val current = _plan.value ?: return
        viewModelScope.launch {
            _busy.value = true
            _plan.value = null
            _outcome.value = runCatching { importer.apply(current, _decisions.value) }
                .fold(
                    onSuccess = { TransferOutcome.Imported(it) },
                    onFailure = { TransferOutcome.ImportFailed(ImportProblem.UNREADABLE) },
                )
            _busy.value = false
        }
    }

    /** Backing out leaves the tree exactly as it was; only the temporary copy is removed. */
    fun cancelImport() {
        _plan.value?.let(importer::discard)
        _plan.value = null
        _decisions.value = emptyMap()
    }
}
