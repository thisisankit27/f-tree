package com.vibethroughcode.ftree.update

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The updater decides, from a stranger's JSON, whether to download and run code. Everything that
 * decision rests on is pure, and settled here rather than against the live API.
 */
class ReleaseTest {

    private fun v(text: String) = AppVersion.parse(text)!!

    /* ------------------------------------------------------------------ versions */

    @Test
    fun `versions compare by number, not by text`() {
        // The whole reason not to compare strings: "0.10.0" sorts before "0.9.0" alphabetically.
        assertTrue(v("0.10.0") > v("0.9.0"))
        assertTrue(v("1.0.0") > v("0.99.99"))
        assertTrue(v("0.1.2") > v("0.1.1"))
        assertEquals(0, v("0.1.1").compareTo(v("0.1.1")))
    }

    @Test
    fun `a leading v and missing components are tolerated`() {
        assertEquals(v("0.1.1"), v("v0.1.1"))
        assertTrue(v("2") > v("1.9.9"))
        assertEquals(0, v("1.0").compareTo(v("1.0.0")))
    }

    @Test
    fun `a pre-release loses to the same version without one`() {
        assertTrue(v("0.2.0") > v("0.2.0-beta1"))
        assertTrue(v("0.2.0-beta2") > v("0.2.0-beta1"))
        assertTrue(v("0.2.0-beta1") > v("0.1.9"))
    }

    @Test
    fun `anything that is not a version parses to nothing rather than to a guess`() {
        assertNull(AppVersion.parse("latest"))
        assertNull(AppVersion.parse(""))
        assertNull(AppVersion.parse(null))
        assertNull(AppVersion.parse("v"))
    }

    /* ------------------------------------------------------------------ releases */

    private fun payload(
        tag: String = "v0.2.0",
        draft: Boolean = false,
        prerelease: Boolean = false,
        assets: String = """{
            "name": "f-tree-0.2.0.apk",
            "browser_download_url": "https://github.com/x/y/releases/download/v0.2.0/f-tree-0.2.0.apk",
            "size": 1998000,
            "digest": "sha256:2e5bffbb0559db8e8578547ca24df37f61f423cf344a73f34affb5fe590b12e7"
        }""",
    ) = """
        {
          "tag_name": "$tag",
          "draft": $draft,
          "prerelease": $prerelease,
          "body": "Fixed a thing.",
          "published_at": "2026-09-04T10:00:00Z",
          "assets": [$assets],
          "some_field_we_have_never_seen": 7
        }
    """.trimIndent()

    @Test
    fun `a newer release is offered, with its checksum`() {
        val lookup = readRelease(payload(), v("0.1.1"))

        val update = (lookup as ReleaseLookup.Newer).update
        assertEquals(v("0.2.0"), update.version)
        assertEquals("f-tree-0.2.0.apk", update.fileName)
        assertEquals(1998000L, update.sizeBytes)
        assertEquals(
            "2e5bffbb0559db8e8578547ca24df37f61f423cf344a73f34affb5fe590b12e7",
            update.sha256,
        )
        assertEquals("Fixed a thing.", update.notes)
    }

    @Test
    fun `the running version and an older one are both up to date`() {
        assertEquals(ReleaseLookup.UpToDate, readRelease(payload(tag = "v0.1.1"), v("0.1.1")))
        assertEquals(ReleaseLookup.UpToDate, readRelease(payload(tag = "v0.1.0"), v("0.1.1")))
    }

    @Test
    fun `drafts and pre-releases are not offered by default`() {
        assertEquals(
            ReleaseLookup.NoUsableRelease,
            readRelease(payload(draft = true), v("0.1.1")),
        )
        assertEquals(
            ReleaseLookup.NoUsableRelease,
            readRelease(payload(prerelease = true), v("0.1.1")),
        )
        assertTrue(
            readRelease(payload(prerelease = true), v("0.1.1"), allowPreRelease = true)
                is ReleaseLookup.Newer,
        )
    }

    @Test
    fun `a release with no APK is not something to install`() {
        val sourceOnly = """{
            "name": "Source code (zip)",
            "browser_download_url": "https://github.com/x/y/archive/v0.2.0.zip",
            "size": 40000
        }"""
        assertEquals(
            ReleaseLookup.NoUsableRelease,
            readRelease(payload(assets = sourceOnly), v("0.1.1")),
        )
    }

    @Test
    fun `an APK offered over plain http is refused`() {
        // Nothing downgrades to http on the way to installing code.
        val insecure = """{
            "name": "f-tree-0.2.0.apk",
            "browser_download_url": "http://example.com/f-tree-0.2.0.apk",
            "size": 10
        }"""
        assertEquals(
            ReleaseLookup.NoUsableRelease,
            readRelease(payload(assets = insecure), v("0.1.1")),
        )
    }

    @Test
    fun `a tag that is not a version is not treated as one`() {
        assertEquals(ReleaseLookup.NoUsableRelease, readRelease(payload(tag = "nightly"), v("0.1.1")))
    }

    @Test
    fun `a missing or malformed digest is carried as absent rather than as a wrong one`() {
        val noDigest = """{
            "name": "f-tree-0.2.0.apk",
            "browser_download_url": "https://example.com/f-tree-0.2.0.apk",
            "size": 10
        }"""
        assertNull((readRelease(payload(assets = noDigest), v("0.1.1")) as ReleaseLookup.Newer).update.sha256)

        val shortDigest = """{
            "name": "f-tree-0.2.0.apk",
            "browser_download_url": "https://example.com/f-tree-0.2.0.apk",
            "size": 10,
            "digest": "sha256:abc123"
        }"""
        assertNull((readRelease(payload(assets = shortDigest), v("0.1.1")) as ReleaseLookup.Newer).update.sha256)
    }

    @Test
    fun `nonsense from the network is not a crash`() {
        assertEquals(ReleaseLookup.NoUsableRelease, readRelease("", v("0.1.1")))
        assertEquals(ReleaseLookup.NoUsableRelease, readRelease("<html>404</html>", v("0.1.1")))
        assertEquals(ReleaseLookup.NoUsableRelease, readRelease("{}", v("0.1.1")))
    }

    @Test
    fun `an unknown field in the payload does not break the check`() {
        // The GitHub API grows fields; a release must still be readable when it does.
        assertTrue(readRelease(payload(), v("0.1.1")) is ReleaseLookup.Newer)
    }
}
