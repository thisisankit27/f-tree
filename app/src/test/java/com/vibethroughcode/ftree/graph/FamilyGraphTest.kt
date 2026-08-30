package com.vibethroughcode.ftree.graph

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class FamilyGraphTest {

    // great-grandfather -> grandfather -> father -> me, plus an unrelated branch
    private val parents = mapOf(
        "me" to listOf("father", "mother"),
        "father" to listOf("grandfather"),
        "grandfather" to listOf("great-grandfather"),
        "mother" to emptyList(),
        "sister" to listOf("father", "mother"),
    )
    private val parentsOf: (String) -> List<String> = { parents[it].orEmpty() }

    private val children = parents.entries
        .flatMap { (child, ps) -> ps.map { it to child } }
        .groupBy({ it.first }, { it.second })
    private val childrenOf: (String) -> List<String> = { children[it].orEmpty() }

    @Test
    fun `ancestors walk the whole way up`() = runTest {
        assertEquals(
            setOf("father", "mother", "grandfather", "great-grandfather"),
            FamilyGraph.ancestorsOf("me", parentsOf),
        )
    }

    @Test
    fun `someone with no recorded parents has no ancestors`() = runTest {
        assertEquals(emptySet<String>(), FamilyGraph.ancestorsOf("great-grandfather", parentsOf))
    }

    @Test
    fun `descendants walk the whole way down`() = runTest {
        assertEquals(
            setOf("grandfather", "father", "me", "sister"),
            FamilyGraph.descendantsOf("great-grandfather", childrenOf),
        )
    }

    @Test
    fun `a person cannot be their own parent`() = runTest {
        assertTrue(FamilyGraph.wouldCreateAncestorCycle("me", "me", parentsOf))
    }

    @Test
    fun `making a descendant into an ancestor is a cycle`() = runTest {
        // "me" becoming the parent of "grandfather" would close the loop.
        assertTrue(FamilyGraph.wouldCreateAncestorCycle("me", "grandfather", parentsOf))
        assertTrue(FamilyGraph.wouldCreateAncestorCycle("father", "great-grandfather", parentsOf))
    }

    @Test
    fun `ordinary new parents are not cycles`() = runTest {
        assertFalse(FamilyGraph.wouldCreateAncestorCycle("great-grandfather", "someone-new", parentsOf))
        assertFalse(FamilyGraph.wouldCreateAncestorCycle("me", "my-child", parentsOf))
    }

    @Test
    fun `already-cyclic data is traversed without hanging`() = runTest {
        val cyclic = mapOf("a" to listOf("b"), "b" to listOf("c"), "c" to listOf("a"))
        val lookup: (String) -> List<String> = { cyclic[it].orEmpty() }
        assertEquals(setOf("b", "c"), FamilyGraph.ancestorsOf("a", lookup))
    }
}
