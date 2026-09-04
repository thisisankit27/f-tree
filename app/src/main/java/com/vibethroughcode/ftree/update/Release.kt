package com.vibethroughcode.ftree.update

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * A version of the app, as a comparable thing rather than a string.
 *
 * Releases are named `v0.1.1` on the tag and `0.1.1` in the manifest, and "is 0.10.0 newer than
 * 0.9.0?" is exactly the question a string comparison gets wrong.
 */
data class AppVersion(
    val parts: List<Int>,
    /** A `-beta1` suffix. A pre-release always loses to the same version without one. */
    val preRelease: String? = null,
) : Comparable<AppVersion> {

    override fun compareTo(other: AppVersion): Int {
        val length = maxOf(parts.size, other.parts.size)
        for (i in 0 until length) {
            val mine = parts.getOrElse(i) { 0 }
            val theirs = other.parts.getOrElse(i) { 0 }
            if (mine != theirs) return mine - theirs
        }
        // 0.2.0 is newer than 0.2.0-beta1; two pre-releases fall back to ordinary text order.
        return when {
            preRelease == other.preRelease -> 0
            preRelease == null -> 1
            other.preRelease == null -> -1
            else -> preRelease.compareTo(other.preRelease)
        }
    }

    override fun toString(): String =
        parts.joinToString(".") + (preRelease?.let { "-$it" } ?: "")

    companion object {
        private val PATTERN = Regex("""^v?(\d+(?:\.\d+)*)(?:-(.+))?$""")

        /** Returns null for anything that is not a version, rather than guessing at one. */
        fun parse(value: String?): AppVersion? {
            val match = PATTERN.matchEntire(value?.trim().orEmpty()) ?: return null
            val (numbers, suffix) = match.destructured
            return AppVersion(
                parts = numbers.split('.').map { it.toInt() },
                preRelease = suffix.takeIf { it.isNotEmpty() },
            )
        }
    }
}

/* ------------------------------------------------------------------ the GitHub payload */

@Serializable
data class ReleaseAsset(
    val name: String = "",
    @SerialName("browser_download_url") val downloadUrl: String = "",
    val size: Long = 0,
    /** GitHub publishes this as `sha256:<hex>`. Absent on older releases. */
    val digest: String? = null,
)

@Serializable
data class ReleasePayload(
    @SerialName("tag_name") val tag: String = "",
    val name: String? = null,
    val body: String? = null,
    val draft: Boolean = false,
    val prerelease: Boolean = false,
    @SerialName("published_at") val publishedAt: String? = null,
    val assets: List<ReleaseAsset> = emptyList(),
)

/** A release newer than the one running, with everything needed to fetch and check it. */
data class AvailableUpdate(
    val version: AppVersion,
    val notes: String?,
    val publishedAt: String?,
    val downloadUrl: String,
    val fileName: String,
    val sizeBytes: Long,
    /** Lower-case hex, or null when the release predates GitHub publishing digests. */
    val sha256: String?,
)

/**
 * Lenient about what it does not recognise, strict about what it acts on: unknown keys are ignored
 * so a change to the GitHub API does not break update checking, but a release without a downloadable
 * APK is treated as no release at all rather than as something to try installing.
 */
private val json = Json { ignoreUnknownKeys = true }

sealed interface ReleaseLookup {
    data class Newer(val update: AvailableUpdate) : ReleaseLookup
    data object UpToDate : ReleaseLookup
    /** The response parsed, but there is nothing here this app could install. */
    data object NoUsableRelease : ReleaseLookup
}

/**
 * Decides whether a GitHub release is worth offering.
 *
 * Pure, so the awkward cases — a draft, a pre-release, a release whose only asset is a source
 * tarball, a tag that is not a version — are settled in unit tests rather than against the network.
 */
fun readRelease(
    body: String,
    current: AppVersion,
    allowPreRelease: Boolean = false,
): ReleaseLookup {
    val payload = runCatching { json.decodeFromString<ReleasePayload>(body) }.getOrNull()
        ?: return ReleaseLookup.NoUsableRelease

    if (payload.draft) return ReleaseLookup.NoUsableRelease
    if (payload.prerelease && !allowPreRelease) return ReleaseLookup.NoUsableRelease

    val version = AppVersion.parse(payload.tag) ?: return ReleaseLookup.NoUsableRelease
    if (version <= current) return ReleaseLookup.UpToDate

    val apk = payload.assets.firstOrNull {
        it.name.endsWith(".apk", ignoreCase = true) && it.downloadUrl.startsWith("https://")
    } ?: return ReleaseLookup.NoUsableRelease

    return ReleaseLookup.Newer(
        AvailableUpdate(
            version = version,
            notes = payload.body?.trim()?.takeIf { it.isNotEmpty() },
            publishedAt = payload.publishedAt,
            downloadUrl = apk.downloadUrl,
            fileName = apk.name,
            sizeBytes = apk.size,
            sha256 = apk.digest
                ?.removePrefix("sha256:")
                ?.lowercase()
                ?.takeIf { it.length == 64 && it.all(Char::isLetterOrDigit) },
        )
    )
}
