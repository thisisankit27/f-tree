package com.vibethroughcode.ftree.update

import com.vibethroughcode.ftree.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import kotlin.coroutines.coroutineContext

/**
 * The only code in the app that touches the network.
 *
 * Deliberately small and deliberately alone: keeping every request in one file is what makes the
 * claim that nothing else leaves the device checkable by reading rather than by trusting. Plain
 * HttpURLConnection rather than a client library, because two requests do not justify a dependency.
 */
class UpdateClient(
    private val releaseUrl: String = BuildConfig.UPDATE_RELEASE_URL,
) {

    /** Fetches the latest release as raw JSON. Parsing is [readRelease]'s job, and is pure. */
    suspend fun fetchLatestRelease(): String = withContext(Dispatchers.IO) {
        val connection = open(releaseUrl)
        connection.setRequestProperty("Accept", "application/vnd.github+json")
        try {
            val code = connection.responseCode
            if (code == HttpURLConnection.HTTP_NOT_FOUND) {
                throw UpdateException(UpdateFailure.NO_RELEASES)
            }
            // Unauthenticated GitHub allows 60 requests an hour per address, which a manual check
            // will never approach, but saying so beats a bare "failed".
            if (code == 403 || code == 429) throw UpdateException(UpdateFailure.RATE_LIMITED)
            if (code !in 200..299) throw UpdateException(UpdateFailure.SERVER)
            connection.inputStream.bufferedReader().use { it.readText() }
        } catch (e: IOException) {
            throw UpdateException(UpdateFailure.NETWORK, e)
        } finally {
            connection.disconnect()
        }
    }

    /**
     * Downloads to [destination], reporting progress from 0 to 1.
     *
     * Written to a temporary file and moved into place at the end, so an interrupted download can
     * never be mistaken for a complete one and handed to the installer.
     */
    suspend fun download(
        url: String,
        destination: File,
        expectedBytes: Long,
        onProgress: (Float) -> Unit,
    ): File = withContext(Dispatchers.IO) {
        val partial = File(destination.parentFile, destination.name + ".part")
        partial.delete()

        val connection = open(url)
        try {
            if (connection.responseCode !in 200..299) throw UpdateException(UpdateFailure.SERVER)
            val total = connection.contentLengthLong.takeIf { it > 0 } ?: expectedBytes

            connection.inputStream.use { input ->
                partial.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    var written = 0L
                    while (true) {
                        // Cancelling the screen must stop the download, not leak it.
                        coroutineContext.ensureActive()
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                        written += read
                        if (total > 0) onProgress((written.toFloat() / total).coerceIn(0f, 1f))
                    }
                    if (total > 0 && written < total) throw UpdateException(UpdateFailure.TRUNCATED)
                }
            }
        } catch (e: IOException) {
            partial.delete()
            throw UpdateException(UpdateFailure.NETWORK, e)
        } finally {
            connection.disconnect()
        }

        destination.delete()
        if (!partial.renameTo(destination)) {
            partial.delete()
            throw UpdateException(UpdateFailure.STORAGE)
        }
        onProgress(1f)
        destination
    }

    /**
     * HTTPS only, and no redirect off it.
     *
     * HttpURLConnection will not follow https to http on its own, but it also will not tell you it
     * refused, so the scheme is checked here rather than assumed.
     */
    private fun open(url: String): HttpURLConnection {
        if (!url.startsWith("https://")) throw UpdateException(UpdateFailure.INSECURE_URL)
        val connection = URL(url).openConnection() as? HttpsURLConnection
            ?: throw UpdateException(UpdateFailure.INSECURE_URL)
        return connection.apply {
            requestMethod = "GET"
            connectTimeout = 15_000
            readTimeout = 30_000
            instanceFollowRedirects = true
            setRequestProperty("User-Agent", "f-tree/${BuildConfig.VERSION_NAME}")
        }
    }
}

/** Why an update attempt stopped. Each maps to one sentence the reader can act on. */
enum class UpdateFailure {
    NETWORK,
    SERVER,
    RATE_LIMITED,
    NO_RELEASES,
    INSECURE_URL,
    TRUNCATED,
    STORAGE,
    /** The download did not match the checksum GitHub published for it. */
    CHECKSUM,
    /** The download is signed by a different key, so it could not update this app anyway. */
    SIGNATURE,
    /** The download is a different app entirely. */
    WRONG_PACKAGE,
    /** Android has not been given permission to install packages from this app. */
    INSTALL_NOT_PERMITTED,
}

class UpdateException(val failure: UpdateFailure, cause: Throwable? = null) :
    Exception(failure.name, cause)
