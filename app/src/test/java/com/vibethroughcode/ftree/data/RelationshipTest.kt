package com.vibethroughcode.ftree.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RelationshipTest {

    @Test
    fun `symmetric edges are stored in canonical order whichever way round they are created`() {
        val one = Relationship.of("zoe", "adam", RelationshipType.SPOUSE)
        val other = Relationship.of("adam", "zoe", RelationshipType.SPOUSE)

        assertEquals("adam", one.fromPersonId)
        assertEquals("zoe", one.toPersonId)
        assertEquals(one.fromPersonId, other.fromPersonId)
        assertEquals(one.toPersonId, other.toPersonId)
    }

    @Test
    fun `parent edges keep their direction because it carries meaning`() {
        val edge = Relationship.of("zoe", "adam", RelationshipType.PARENT)
        assertEquals("zoe", edge.fromPersonId)
        assertEquals("adam", edge.toPersonId)
    }

    @Test
    fun `the other end of an edge is resolvable from either side`() {
        val edge = Relationship.of("a", "b", RelationshipType.SPOUSE)
        assertEquals("b", edge.other("a"))
        assertEquals("a", edge.other("b"))
        assertNull(edge.other("someone-else"))
    }

    @Test
    fun `an unrecognised type falls back to UNKNOWN rather than failing`() {
        assertEquals(RelationshipType.UNKNOWN, RelationshipType.fromName("GODPARENT_FROM_A_FUTURE_VERSION"))
        assertEquals(RelationshipType.UNKNOWN, RelationshipType.fromName(null))
        assertEquals(RelationshipType.PARENT, RelationshipType.fromName("PARENT"))
    }

    @Test
    fun `only spouse and sibling are symmetric`() {
        assertTrue(RelationshipType.SPOUSE.isSymmetric)
        assertTrue(RelationshipType.SIBLING.isSymmetric)
        assertEquals(false, RelationshipType.PARENT.isSymmetric)
    }
}
