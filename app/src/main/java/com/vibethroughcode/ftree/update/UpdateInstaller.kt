package com.vibethroughcode.ftree.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File

/**
 * Hands a verified APK to Android's package installer.
 *
 * This is an install *over* the copy already running, not a fresh one, which is the entire point:
 * Android keeps the app's data directory across an update, so the family survives without anybody
 * exporting and re-importing it. That only holds while the signing key stays the same, which is
 * why [ApkGuard] refuses anything signed differently before this is ever called.
 */
class UpdateInstaller(private val context: Context) {

    /** Android requires per-app consent to install packages, granted in system settings. */
    fun canInstall(): Boolean = context.packageManager.canRequestPackageInstalls()

    /** Sends the reader to the system screen where that consent is given. */
    fun permissionIntent(): Intent =
        Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))

    fun install(file: File) {
        if (!canInstall()) throw UpdateException(UpdateFailure.INSTALL_NOT_PERMITTED)

        val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(intent)
    }

    /** Where downloads live: app-private cache, so an abandoned one is the system's to reclaim. */
    fun downloadDirectory(): File =
        File(context.cacheDir, "updates").apply { mkdirs() }

    /** Removes anything left from an earlier attempt, so a stale APK is never offered. */
    fun clearDownloads() {
        downloadDirectory().listFiles()?.forEach { it.delete() }
    }
}
