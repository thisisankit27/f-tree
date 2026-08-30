package com.vibethroughcode.ftree.graph

import com.vibethroughcode.ftree.data.RelationshipType
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class RelationshipRulesTest {

    /** Edges present in the fake graph, as (from, to, type). */
    private fun rules(
        existing: Set<Triple<String, String, RelationshipType>> = emptySet(),
        parents: Map<String, List<String>> = emptyMap(),
    ): suspend (String, String, RelationshipType) -> RelationshipCheck = { from, to, type ->
        RelationshipRules.check(
            fromPersonId = from,
            toPersonId = to,
            type = type,
            existingEdgeExists = { f, t, ty -> Triple(f, t, ty) in existing },
            parentsOf = { parents[it].orEmpty() },
        )
    }

    private fun assertRejected(reason: RelationshipRejection, actual: RelationshipCheck) =
        assertEquals(RelationshipCheck.Rejected(reason), actual)

    @Test
    fun `a person cannot be their own parent spouse or sibling`() = runTest {
        val check = rules()
        RelationshipType.entries.forEach { type ->
            assertRejected(RelationshipRejection.SELF_REFERENCE, check("me", "me", type))
        }
    }

    @Test
    fun `an identical edge is a duplicate`() = runTest {
        val check = rules(existing = setOf(Triple("father", "me", RelationshipType.PARENT)))
        assertRejected(RelationshipRejection.DUPLICATE, check("father", "me", RelationshipType.PARENT))
    }

    @Test
    fun `a symmetric edge is a duplicate from either side`() = runTest {
        val check = rules(existing = setOf(Triple("a", "b", RelationshipType.SPOUSE)))
        assertRejected(RelationshipRejection.DUPLICATE, check("b", "a", RelationshipType.SPOUSE))
    }

    @Test
    fun `a parent edge is directional so the reverse is not a duplicate`() = runTest {
        // father -> me existing must not block me -> father being *checked*; it is instead
        // rejected as a cycle, which is the accurate reason.
        val check = rules(
            existing = setOf(Triple("father", "me", RelationshipType.PARENT)),
            parents = mapOf("me" to listOf("father")),
        )
        assertRejected(RelationshipRejection.ANCESTOR_CYCLE, check("me", "father", RelationshipType.PARENT))
    }

    @Test
    fun `a parent cannot also be a spouse or sibling of their child`() = runTest {
        val check = rules(existing = setOf(Triple("father", "me", RelationshipType.PARENT)))
        assertRejected(
            RelationshipRejection.CONTRADICTS_EXISTING,
            check("father", "me", RelationshipType.SPOUSE),
        )
        assertRejected(
            RelationshipRejection.CONTRADICTS_EXISTING,
            check("me", "father", RelationshipType.SIBLING),
        )
    }

    @Test
    fun `an edge that would make someone their own ancestor is rejected`() = runTest {
        val check = rules(parents = mapOf("me" to listOf("father"), "father" to listOf("grandfather")))
        assertRejected(
            RelationshipRejection.ANCESTOR_CYCLE,
            check("me", "grandfather", RelationshipType.PARENT),
        )
    }

    @Test
    fun `ordinary relationships are allowed`() = runTest {
        val check = rules(parents = mapOf("me" to listOf("father")))
        assertEquals(RelationshipCheck.Allowed, check("mother", "me", RelationshipType.PARENT))
        assertEquals(RelationshipCheck.Allowed, check("me", "wife", RelationshipType.SPOUSE))
        assertEquals(RelationshipCheck.Allowed, check("me", "child", RelationshipType.PARENT))
        assertEquals(RelationshipCheck.Allowed, check("me", "brother", RelationshipType.SIBLING))
    }
}
