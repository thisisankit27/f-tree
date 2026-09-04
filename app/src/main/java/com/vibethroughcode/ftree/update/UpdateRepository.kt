package com.vibethroughcode.ftree.update

import com.vibethroughcode.ftree.BuildConfig
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File

/** Where an update attempt has got to. One state, so the screen can never show two things at once. */
sealed interface UpdateState {
    /** Update checking has not been switched on. No request has been made. */
    data object Disabled : UpdateState
    data object Idle : UpdateState
    data object Checking : UpdateState
    data class UpToDate(val checkedAt: Long) : UpdateState
    data class Available(val update: AvailableUpdate) : UpdateState
    data class Downloading(val update: AvailableUpdate, val progress: Float) : UpdateState
    /** Downloaded, checksum matched, signed by the same key. Safe to hand to Android. */
    data class Ready(val update: AvailableUpdate, val file: File) : UpdateState
    data class Failed(val failure: UpdateFailure) : UpdateState
}

/**
 * Checking for, fetching and verifying a new version.
 *
 * Every path out of here runs through [UpdatePreferences.enabled]: with updates switched off the
 * repository will not make a request even if something asks it to. That is what makes "no network
 * unless you turn it on" a property of the code rather than of the user interface.
 */
class UpdateRepository(
    private val preferences: UpdatePreferences,
    private val client: UpdateClient,
    private val guard: ApkGuard,
    private val installer: UpdateInstaller,
    private val currentVersion: AppVersion? = AppVersion.parse(BuildConfig.VERSION_NAME),
) {

    private val _state = MutableStateFlow<UpdateState>(
        if (preferences.enabled.value) UpdateState.Idle else UpdateState.Disabled
    )
    val state: StateFlow<UpdateState> = _state.asStateFlow()

    fun onEnabledChanged(enabled: Boolean) {
        _state.value = if (enabled) UpdateState.Idle else UpdateState.Disabled
        if (!enabled) installer.clearDownloads()
    }

    /** @param manual a check the reader asked for, which reports being up to date rather than staying quiet. */
    suspend fun check(manual: Boolean) {
        if (!preferences.enabled.value) {
            _state.value = UpdateState.Disabled
            return
        }
        if (_state.value is UpdateState.Downloading) return

        _state.value = UpdateState.Checking
        try {
            val body = client.fetchLatestRelease()
            val current = currentVersion ?: AppVersion(listOf(0))
            _state.value = when (val lookup = readRelease(body, current)) {
                is ReleaseLookup.Newer -> {
                    val skipped = preferences.skippedVersion
                    if (!manual && skipped == lookup.update.version.toString()) {
                        UpdateState.UpToDate(System.currentTimeMillis())
                    } else {
                        UpdateState.Available(lookup.update)
                    }
                }
                ReleaseLookup.UpToDate -> UpdateState.UpToDate(System.currentTimeMillis())
                // Nothing installable is not an error worth alarming anyone with; from the
                // reader's side it is indistinguishable from being up to date.
                ReleaseLookup.NoUsableRelease -> UpdateState.UpToDate(System.currentTimeMillis())
            }
            preferences.lastCheckedAt = System.currentTimeMillis()
        } catch (e: CancellationException) {
            throw e
        } catch (e: UpdateException) {
            _state.value = UpdateState.Failed(e.failure)
        } catch (_: Exception) {
            _state.value = UpdateState.Failed(UpdateFailure.NETWORK)
        }
    }

    /**
     * Downloads and verifies, but does not install: handing an APK to Android opens a system
     * prompt, and that should happen because somebody pressed install, not because a download
     * finished while they were looking at something else.
     */
    suspend fun download(update: AvailableUpdate) {
        if (!preferences.enabled.value) return
        _state.value = UpdateState.Downloading(update, 0f)
        try {
            installer.clearDownloads()
            val destination = File(installer.downloadDirectory(), update.fileName)
            client.download(update.downloadUrl, destination, update.sizeBytes) { progress ->
                _state.value = UpdateState.Downloading(update, progress)
            }
            guard.verify(destination, update.sha256)
            _state.value = UpdateState.Ready(update, destination)
        } catch (e: CancellationException) {
            installer.clearDownloads()
            _state.value = UpdateState.Available(update)
            throw e
        } catch (e: UpdateException) {
            installer.clearDownloads()
            _state.value = UpdateState.Failed(e.failure)
        } catch (_: Exception) {
            installer.clearDownloads()
            _state.value = UpdateState.Failed(UpdateFailure.NETWORK)
        }
    }

    fun install(file: File) {
        try {
            installer.install(file)
        } catch (e: UpdateException) {
            _state.value = UpdateState.Failed(e.failure)
        }
    }

    fun skip(update: AvailableUpdate) {
        preferences.skippedVersion = update.version.toString()
        installer.clearDownloads()
        _state.value = UpdateState.UpToDate(System.currentTimeMillis())
    }

    fun dismissFailure() {
        _state.value = if (preferences.enabled.value) UpdateState.Idle else UpdateState.Disabled
    }

    fun canInstall(): Boolean = installer.canInstall()

    fun permissionIntent() = installer.permissionIntent()
}
