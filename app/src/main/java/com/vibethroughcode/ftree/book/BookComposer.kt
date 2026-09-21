package com.vibethroughcode.ftree.book

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.ByteArrayInputStream
import java.io.IOException

/**
 * Lays the family book out by running the book's own composer - `site/book/compose.js`, the file
 * the desktop runs - in a WebView nobody sees.
 *
 * Why a WebView: the composer is the one place the book is laid out, written once so the phone and
 * the desktop give the same pages (docs/family-book.md). A second layout in Kotlin would have to be
 * kept in step with it forever. The System WebView is already on every phone this app runs on, and
 * here it is used as nothing more than a script engine: it is never attached to a window, it can
 * reach only the app's own assets, and it is destroyed when the screen that needed it goes.
 *
 * The locks, in the order a request meets them:
 *  1. [BookWebClient] answers every request itself - an asset, or a 404 - so none can reach the
 *     network, whatever the page asks for. [WebSettings.setBlockNetworkLoads] says the same again.
 *  2. The host page's Content-Security-Policy allows scripts from its own origin and nothing else.
 *  3. File and content access are off; the manifest opts out of WebView metrics and Safe Browsing.
 *
 * One composer per book screen. [compose] may be called as often as the reader changes an option;
 * the page is loaded once and kept. Every call to the WebView happens on the main thread, as the
 * platform requires; the bridge's methods arrive on the WebView's own thread and only complete
 * deferreds, and parsing the returned book happens off the main thread.
 */
class BookComposer(private val context: Context) : AutoCloseable {

    private val main = Handler(Looper.getMainLooper())
    private val lock = Mutex()
    private var webView: WebView? = null
    private var ready = CompletableDeferred<Unit>()
    @Volatile private var pending: CompletableDeferred<String>? = null
    @Volatile private var input: String = ""

    /**
     * Composes one book. [inputJson] is `{doc, options, template, allowance}`, exactly the
     * arguments `composeBook` takes. Throws [BookFailure] for anything that stops the book.
     */
    suspend fun compose(inputJson: String): Book {
        val json = run(inputJson, "ftreeCompose()")
        return withContext(Dispatchers.Default) {
            try {
                readBook(json)
            } catch (e: Exception) {
                throw BookFailure.Script("the composer returned a book this app cannot read: ${e.message}")
            }
        }
    }

    /**
     * Who `resolveFeatured` (`site/book/story/featured.js`) would pick for [inputJson] - the same
     * `{doc, options, template, allowance}` [compose] takes - without laying out a whole book.
     *
     * This exists only to prefill the book screen's "Whose story" row until the reader picks
     * somebody themselves ([BookViewModel]), so it fails quietly: a stale WebView or a document
     * `resolveFeatured` cannot place returns `null` rather than a second [BookFailure] alongside
     * whatever the next real [compose] already reports.
     */
    suspend fun resolveFeatured(inputJson: String): String? = try {
        val json = run(inputJson, "ftreeFeatured()")
        withContext(Dispatchers.Default) {
            Json.parseToJsonElement(json).jsonObject["featured"]?.jsonPrimitive?.contentOrNull
        }
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        null
    }

    /** Sends [inputJson] to the composer page and calls [jsCall], returning whatever it delivers. */
    private suspend fun run(inputJson: String, jsCall: String): String = lock.withLock {
        val result = CompletableDeferred<String>()
        withContext(Dispatchers.Main) {
            open()
            try {
                withTimeout(LOAD_TIMEOUT_MS) { ready.await() }
            } catch (e: Throwable) {
                // A page that failed to load stays failed; the next attempt starts from nothing.
                tearDown()
                throw e as? BookFailure ?: if (e is kotlinx.coroutines.TimeoutCancellationException) BookFailure.TimedOut else BookFailure.Script(e.message ?: e.toString())
            }
            input = inputJson
            pending = result
            webView?.evaluateJavascript(jsCall, null)
        }
        try {
            withTimeout(COMPOSE_TIMEOUT_MS) { result.await() }
        } catch (timeout: kotlinx.coroutines.TimeoutCancellationException) {
            throw BookFailure.TimedOut
        } finally {
            pending = null
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun open() {
        if (webView != null) return
        WebViewSupport.check(context)
        val view = try {
            WebView(context.applicationContext)
        } catch (e: Exception) {
            // Thrown while the System WebView is missing, disabled or mid-update.
            throw BookFailure.NoWebView
        }
        ready = CompletableDeferred()
        view.settings.apply {
            javaScriptEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            blockNetworkLoads = true
            safeBrowsingEnabled = false
            domStorageEnabled = false
            databaseEnabled = false
        }
        view.webViewClient = BookWebClient(context, onGone = {
            pending?.completeExceptionally(BookFailure.Crashed)
            ready.completeExceptionally(BookFailure.Crashed)
            main.post { tearDown() }
        })
        view.addJavascriptInterface(Bridge(), "FTreeBook")
        view.loadUrl("https://$HOST/bookhost/index.html")
        webView = view
    }

    /** Releases the WebView's renderer - tens of megabytes on a small phone. Safe to call twice. */
    override fun close() {
        if (Looper.myLooper() == Looper.getMainLooper()) tearDown() else main.post { tearDown() }
    }

    private fun tearDown() {
        webView?.apply {
            removeJavascriptInterface("FTreeBook")
            stopLoading()
            destroy()
        }
        webView = null
    }

    /** The page's only way to talk to the app. Called on the WebView's bridge thread. */
    private inner class Bridge {
        @JavascriptInterface fun input(): String = input
        @JavascriptInterface fun ready() { ready.complete(Unit) }
        @JavascriptInterface fun deliver(json: String) { pending?.complete(json) }
        @JavascriptInterface fun fail(message: String) {
            val failure = BookFailure.Script(message)
            if (!ready.isCompleted) ready.completeExceptionally(failure)
            pending?.completeExceptionally(failure)
        }
    }

    companion object {
        /** The address Android reserves for serving an app's own assets to a WebView. */
        const val HOST = "appassets.androidplatform.net"
        private const val LOAD_TIMEOUT_MS = 20_000L
        private const val COMPOSE_TIMEOUT_MS = 30_000L
    }
}

/**
 * Serves the host page and the staged engine from assets, and refuses everything else with a 404 -
 * never `null`, which would let the WebView go and fetch it.
 */
internal class BookWebClient(private val context: Context, private val onGone: () -> Unit) : WebViewClient() {

    override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse {
        val url = request.url
        val path = url.path.orEmpty()
        if (url.scheme != "https" || url.host != BookComposer.HOST || !ALLOWED.any { path.startsWith(it) } || ".." in path) {
            return notFound()
        }
        val asset = path.removePrefix("/")
        return try {
            WebResourceResponse(mimeOf(asset), "utf-8", context.assets.open(asset))
        } catch (missing: IOException) {
            notFound()
        }
    }

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = true

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        // Returning true keeps the app alive when the system reclaims the renderer.
        onGone()
        return true
    }

    private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))

    private fun mimeOf(asset: String) = when (asset.substringAfterLast('.')) {
        "html" -> "text/html"
        "js" -> "text/javascript"
        "json" -> "application/json"
        else -> "application/octet-stream"
    }

    private companion object {
        val ALLOWED = listOf("/bookhost/", "/book/site/")
    }
}

/** Why a book could not be made, each with something the reader can do about it. */
sealed class BookFailure(message: String) : Exception(message) {
    data object NoWebView : BookFailure("Android System WebView is missing or switched off")
    data class OldWebView(val version: String) : BookFailure("Android System WebView $version is too old")
    data object Crashed : BookFailure("the page renderer stopped")
    data object TimedOut : BookFailure("making the book took too long")
    data class Script(val detail: String) : BookFailure(detail)
}

/**
 * The composer uses JavaScript that Chrome 80 and later understand (`?.`, `??`). Every phone that
 * has updated its System WebView since 2020 has it; one that has not is told to, rather than shown
 * a blank book.
 */
object WebViewSupport {
    const val MINIMUM_MAJOR = 80

    fun check(context: Context) {
        val info = WebView.getCurrentWebViewPackage() ?: throw BookFailure.NoWebView
        val version = info.versionName.orEmpty()
        val major = version.substringBefore('.').toIntOrNull() ?: return
        if (major < MINIMUM_MAJOR) throw BookFailure.OldWebView(version)
    }
}
