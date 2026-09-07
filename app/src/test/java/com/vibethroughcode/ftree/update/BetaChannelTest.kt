package com.vibethroughcode.ftree.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Which release each channel is willing to be offered.
 *
 * The separation is the whole feature: somebody on the ordinary channel must never be handed an
 * unfinished build, and somebody on the beta channel must be offered whichever is newest — beta or
 * the stable release that supersedes it.
 */
class BetaChannelTest {

    private fun release(
        tag: String,
        prerelease: Boolean = false,
        draft: Boolean = false,
        apk: Boolean = true,
    ) = """
        {
          "tag_name": "$tag",
          "draft": $draft,
          "prerelease": $prerelease,
          "published_at": "2026-09-07T00:00:00Z",
          "body": "notes",
          "assets": ${if (apk) """[{"name":"f-tree-x.apk","browser_download_url":"https://example.com/x.apk","size":1}]""" else "[]"}
        }
    """.trimIndent()

    private fun list(vararg releases: String) = releases.joinToString(",", "[", "]")

    private val current = AppVersion.parse("0.5.1")!!

    @Test
    fun `the ordinary channel refuses a pre-release outright`() {
        val lookup = readRelease(release("v0.6.0-beta.1", prerelease = true), current)
        assertEquals(ReleaseLookup.NoUsableRelease, lookup)
    }

    @Test
    fun `the beta channel is offered the newest beta`() {
        val lookup = readReleases(
            list(release("v0.6.0-beta.1", prerelease = true), release("v0.5.1")),
            current,
            allowPreRelease = true,
        )
        assertEquals("0.6.0-beta.1", (lookup as ReleaseLookup.Newer).update.version.toString())
    }

    @Test
    fun `a beta reader is moved on to the stable release that supersedes it`() {
        val onBeta = AppVersion.parse("0.6.0-beta.1")!!
        val lookup = readReleases(
            list(release("v0.6.0"), release("v0.6.0-beta.1", prerelease = true)),
            onBeta,
            allowPreRelease = true,
        )
        assertEquals("0.6.0", (lookup as ReleaseLookup.Newer).update.version.toString())
    }

    @Test
    fun `a beta reader already on the newest beta is up to date`() {
        val onBeta = AppVersion.parse("0.6.0-beta.1")!!
        val lookup = readReleases(
            list(release("v0.6.0-beta.1", prerelease = true), release("v0.5.1")),
            onBeta,
            allowPreRelease = true,
        )
        assertEquals(ReleaseLookup.UpToDate, lookup)
    }

    @Test
    fun `reading the list on the ordinary channel still skips every pre-release`() {
        val lookup = readReleases(
            list(release("v0.6.0-beta.2", prerelease = true), release("v0.5.1")),
            current,
            allowPreRelease = false,
        )
        assertEquals(ReleaseLookup.UpToDate, lookup)
    }

    @Test
    fun `drafts never count on either channel`() {
        val lookup = readReleases(
            list(release("v9.9.9", draft = true), release("v0.5.1")),
            current,
            allowPreRelease = true,
        )
        assertEquals(ReleaseLookup.UpToDate, lookup)
    }

    @Test
    fun `a release with no apk attached is nothing to offer rather than an error`() {
        val lookup = readReleases(
            list(release("v0.6.0-beta.1", prerelease = true, apk = false)),
            current,
            allowPreRelease = true,
        )
        assertEquals(ReleaseLookup.NoUsableRelease, lookup)
    }

    @Test
    fun `a beta loses to the same version without the suffix`() {
        assertTrue(AppVersion.parse("0.6.0-beta.1")!! < AppVersion.parse("0.6.0")!!)
        assertTrue(AppVersion.parse("0.5.1")!! < AppVersion.parse("0.6.0-beta.1")!!)
    }
}
