package com.vibethroughcode.ftree.graph

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

/** Who travels when one person's family is shared. */
class BranchTest {

    /**
     * Sandeep married Pragya and they have Ankit and Sarika. Ankit married Priya and they have
     * Aarav. Sandeep also has a brother, a father, and a nephew through the brother — none of whom
     * are his to give away.
     */
    private val children = mapOf(
        "father" to listOf("sandeep", "brother"),
        "sandeep" to listOf("ankit", "sarika"),
        "pragya" to listOf("ankit", "sarika"),
        "ankit" to listOf("aarav"),
        "priya" to listOf("aarav"),
        "brother" to listOf("nephew"),
    )
    private val spouses = mapOf(
        "sandeep" to listOf("pragya"),
        "pragya" to listOf("sandeep"),
        "ankit" to listOf("priya"),
        "priya" to listOf("ankit"),
        "father" to listOf("mother"),
        "mother" to listOf("father"),
    )

    private suspend fun branch(of: String) = FamilyGraph.branchFrom(
        personId = of,
        childrenOf = { children[it].orEmpty() },
        spousesOf = { spouses[it].orEmpty() },
    )

    @Test
    fun `a branch is the person, everyone below them, and whoever they married`() = runTest {
        assertEquals(
            setOf("sandeep", "pragya", "ankit", "sarika", "priya", "aarav"),
            branch("sandeep"),
        )
    }

    @Test
    fun `it does not reach upwards or sideways`() = runTest {
        val shared = branch("sandeep")
        listOf("father", "mother", "brother", "nephew").forEach {
            assertEquals("$it should not travel", false, it in shared)
        }
    }

    @Test
    fun `a partner's own parents are not a doorway into their family`() = runTest {
        // Priya is in Ankit's branch because he married her; her people are not.
        val shared = branch("ankit")
        assertEquals(setOf("ankit", "priya", "aarav"), shared)
    }

    @Test
    fun `somebody with nobody below them shares themselves and their partner`() = runTest {
        assertEquals(setOf("sarika"), branch("sarika"))
        assertEquals(setOf("pragya", "sandeep", "ankit", "sarika", "priya", "aarav"), branch("pragya"))
    }
}
