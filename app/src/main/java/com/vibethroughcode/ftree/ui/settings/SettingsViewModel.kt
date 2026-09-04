package com.vibethroughcode.ftree.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vibethroughcode.ftree.update.AvailableUpdate
import com.vibethroughcode.ftree.update.UpdatePreferences
import com.vibethroughcode.ftree.update.UpdateRepository
import com.vibethroughcode.ftree.update.UpdateState
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import java.io.File

class SettingsViewModel(
    private val preferences: UpdatePreferences,
    private val updates: UpdateRepository,
) : ViewModel() {

    val updatesEnabled: StateFlow<Boolean> = preferences.enabled
    val updateState: StateFlow<UpdateState> = updates.state

    private var work: Job? = null

    fun setUpdatesEnabled(enabled: Boolean) {
        preferences.setEnabled(enabled)
        updates.onEnabledChanged(enabled)
        work?.cancel()
        // Switching it on is itself the consent to look, so the first check happens straight away
        // rather than leaving the reader to press a second button to find out.
        if (enabled) check()
    }

    fun check() {
        work?.cancel()
        work = viewModelScope.launch { updates.check(manual = true) }
    }

    fun download(update: AvailableUpdate) {
        work?.cancel()
        work = viewModelScope.launch { updates.download(update) }
    }

    fun cancel() {
        work?.cancel()
        work = null
    }

    fun install(file: File) = updates.install(file)

    fun skip(update: AvailableUpdate) = updates.skip(update)

    fun dismissFailure() = updates.dismissFailure()

    fun canInstall(): Boolean = updates.canInstall()

    fun permissionIntent() = updates.permissionIntent()

    override fun onCleared() {
        work?.cancel()
    }
}
