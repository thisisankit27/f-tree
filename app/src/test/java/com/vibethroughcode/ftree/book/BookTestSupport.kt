package com.vibethroughcode.ftree.book

import kotlinx.serialization.SerializationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Assume.assumeTrue
import java.io.File
import java.util.concurrent.TimeUnit

/*
 * What the book's JVM tests share: where the repository is, running the JavaScript side in node,
 * and reading a book that must be refused.
 */

/** The repository root, the directory holding `settings.gradle.kts`: where `site/` is read from. */
internal val repoRoot: File = generateSequence(File(System.getProperty("user.dir")).absoluteFile) { it.parentFile }
    .first { File(it, "settings.gradle.kts").exists() }

/**
 * The node binary, or the test is skipped when there is none - unless `FTREE_REQUIRE_NODE=1`, when
 * a missing node fails it instead, so CI cannot pass a cross-language test by not running it.
 */
internal fun nodeOrSkip(): String {
    val node = if (System.getProperty("os.name").startsWith("Windows")) "node.exe" else "node"
    val available = try {
        ProcessBuilder(node, "--version").start().waitFor(10, TimeUnit.SECONDS)
    } catch (e: Exception) {
        false
    }
    if (System.getenv("FTREE_REQUIRE_NODE") == "1") assertTrue("FTREE_REQUIRE_NODE is set and node is not on the path", available)
    else assumeTrue("node is not on the path", available)
    return node
}

/** Runs [script] as an ES module in node with [args], and returns what it wrote to stdout. */
internal fun runNode(script: String, vararg args: String): String {
    val process = ProcessBuilder(nodeOrSkip(), "--input-type=module", "-e", script, *args).start()
    val out = process.inputStream.bufferedReader().readText()
    val err = process.errorStream.bufferedReader().readText()
    assertTrue("node did not finish", process.waitFor(60, TimeUnit.SECONDS))
    assertEquals(err, 0, process.exitValue())
    return out
}

/** Reads [text], which must be refused, and returns why. */
internal fun refusal(text: String, fontKeys: Set<String> = BookFonts.FILES.keys): String {
    try {
        readBook(text, fontKeys)
    } catch (expected: SerializationException) {
        return expected.message.orEmpty()
    } catch (expected: IllegalArgumentException) {
        return expected.message.orEmpty()   // kotlinx.serialization reports some shape errors this way
    }
    fail("read a book it should have refused: ${text.take(300)}")
    error("unreachable")
}
