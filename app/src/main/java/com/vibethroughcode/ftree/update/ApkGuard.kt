package com.vibethroughcode.ftree.update

import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.security.MessageDigest

/**
 * What gets checked before a downloaded APK is handed to the package installer.
 *
 * Three questions, in the order that matters. Is this file the one GitHub published? Is it this
 * app? Is it signed by the key that signed the copy already installed?
 *
 * The third is the one that actually protects the tree. An APK signed with a different key cannot
 * update this one — Android refuses it — and the only way to install it would be to uninstall
 * first, which takes the family with it. Checking here means the reader is told that plainly
 * instead of meeting a failure at the end of a download, and it means a substituted file is
 * rejected by this app before Android is ever asked to open it.
 */
class ApkGuard(private val context: Context) {

    suspend fun verify(file: File, expectedSha256: String?): Unit = withContext(Dispatchers.IO) {
        if (expectedSha256 != null && sha256(file) != expectedSha256) {
            throw UpdateException(UpdateFailure.CHECKSUM)
        }

        val packageManager = context.packageManager
        val archive = packageManager.getPackageArchiveInfo(file.path, signingFlags())
            ?: throw UpdateException(UpdateFailure.SIGNATURE)

        if (archive.packageName != context.packageName) {
            throw UpdateException(UpdateFailure.WRONG_PACKAGE)
        }

        val installed = signaturesOf(context.packageName)
        val candidate = signaturesOfArchive(file)
        // Fails closed: a certificate that cannot be read is not treated as a matching one.
        if (installed.isEmpty() || candidate.isEmpty() || installed != candidate) {
            throw UpdateException(UpdateFailure.SIGNATURE)
        }
    }

    fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    @Suppress("DEPRECATION")
    private fun signingFlags(): Int =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) PackageManager.GET_SIGNING_CERTIFICATES
        else PackageManager.GET_SIGNATURES

    @Suppress("DEPRECATION")
    private fun signaturesOf(packageName: String): Set<String> = runCatching {
        val info = context.packageManager.getPackageInfo(packageName, signingFlags())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.signingInfo?.let { fingerprints(it.apkContentsSigners) }
        } else {
            fingerprints(info.signatures)
        }
    }.getOrNull().orEmpty()

    @Suppress("DEPRECATION")
    private fun signaturesOfArchive(file: File): Set<String> = runCatching {
        val info = context.packageManager.getPackageArchiveInfo(file.path, signingFlags())
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info?.signingInfo?.let { fingerprints(it.apkContentsSigners) }
        } else {
            fingerprints(info?.signatures)
        }
    }.getOrNull().orEmpty()

    private fun fingerprints(signatures: Array<Signature>?): Set<String> =
        signatures.orEmpty().map { signature ->
            MessageDigest.getInstance("SHA-256")
                .digest(signature.toByteArray())
                .joinToString("") { "%02x".format(it) }
        }.toSet()
}
