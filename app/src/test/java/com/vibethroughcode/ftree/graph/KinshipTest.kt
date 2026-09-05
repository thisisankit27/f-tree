package com.vibethroughcode.ftree.graph

import com.vibethroughcode.ftree.data.Person
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The relation finder answers a question people can check against their own memory, so a wrong
 * answer is worse than no answer. Every shape of family that has its own word in English is
 * pinned here, along with the ones that have no word and must fall back to the chain.
 */
class KinshipTest {

    private class Builder {
        private val people = mutableMapOf<String, Person>()
        private val parents = mutableListOf<Pair<String, String>>()
        private val spouses = mutableListOf<Pair<String, String>>()
        private val siblings = mutableListOf<Pair<String, String>>()

        fun person(vararg ids: String) = apply {
            ids.forEach { people[it] = Person(id = it, name = it) }
        }

        fun parentOf(parent: String, vararg children: String) = apply {
            children.forEach { parents += parent to it }
        }

        fun married(a: String, b: String) = apply { spouses += a to b }
        fun siblingOf(a: String, b: String) = apply { siblings += a to b }
        fun build() = FamilySnapshot(people, parents, spouses, siblings)
    }

    /**
     * Four generations with two branches, which between them contain every term worth having:
     *
     *              great ── great-wife
     *                    │
     *          ┌─────────┴──────────┐
     *        grandad ── granny    granduncle
     *          │                    │
     *      ┌───┴────┐            cousin-parent
     *     dad ── mum  aunt          │
     *      │                     second-line
     *     me ── wife
     *      │
     *     kid
     */
    private fun family() = Builder()
        .person("great", "great-wife", "grandad", "granny", "granduncle")
        .person("dad", "mum", "aunt", "me", "wife", "kid")
        .person("cousin-parent", "second-line")
        .person("wifes-mother")
        .married("great", "great-wife")
        .married("grandad", "granny")
        .married("dad", "mum")
        .married("me", "wife")
        .parentOf("great", "grandad", "granduncle")
        .parentOf("great-wife", "grandad", "granduncle")
        .parentOf("grandad", "dad", "aunt")
        .parentOf("granny", "dad", "aunt")
        .parentOf("dad", "me")
        .parentOf("mum", "me")
        .parentOf("me", "kid")
        .parentOf("wife", "kid")
        .parentOf("granduncle", "cousin-parent")
        .parentOf("cousin-parent", "second-line")
        .parentOf("wifes-mother", "wife")
        .build()

    private fun term(from: String, to: String): KinshipTerm? =
        (Kinship.relate(family(), from, to) as Relation.Found).term

    private fun chain(from: String, to: String): List<RelationStep> =
        (Kinship.relate(family(), from, to) as Relation.Found).chain

    /* --------------------------------------------------------------- the words */

    @Test
    fun `the straight line up and down is named by its generations`() {
        assertEquals(KinshipTerm.Ancestor(1), term("me", "dad"))
        assertEquals(KinshipTerm.Ancestor(2), term("me", "grandad"))
        assertEquals(KinshipTerm.Ancestor(3), term("me", "great"))
        assertEquals(KinshipTerm.Descendant(1), term("me", "kid"))
        assertEquals(KinshipTerm.Descendant(3), term("grandad", "kid"))
        assertEquals(KinshipTerm.Descendant(4), term("great", "kid"))
    }

    @Test
    fun `siblings, aunts and nieces come out of the same two numbers`() {
        assertEquals(KinshipTerm.Sibling, term("dad", "aunt"))
        assertEquals(KinshipTerm.ParentsSibling(greats = 0), term("me", "aunt"))
        assertEquals(KinshipTerm.ParentsSibling(greats = 1), term("me", "granduncle"))
        assertEquals(KinshipTerm.SiblingsChild(greats = 0), term("aunt", "me"))
        assertEquals(KinshipTerm.SiblingsChild(greats = 1), term("granduncle", "me"))
    }

    @Test
    fun `cousins carry both a degree and a remove`() {
        // me and cousin-parent share "great": two up, two down.
        assertEquals(KinshipTerm.Cousin(degree = 1, removed = 0), term("dad", "cousin-parent"))
        assertEquals(KinshipTerm.Cousin(degree = 1, removed = 1), term("me", "cousin-parent"))
        assertEquals(KinshipTerm.Cousin(degree = 2, removed = 0), term("me", "second-line"))
        assertEquals(KinshipTerm.Cousin(degree = 1, removed = 2), term("kid", "cousin-parent"))
    }

    @Test
    fun `the nearest shared ancestor names it, not the most distant one`() {
        // dad and aunt share both their parents and both their grandparents; measured through a
        // grandparent they would come out as first cousins rather than as brother and sister.
        assertEquals(KinshipTerm.Sibling, term("dad", "aunt"))
    }

    @Test
    fun `a term is a claim about blood, so marriage does not get one`() {
        assertNull(term("me", "wife"))
        assertNull(term("me", "wifes-mother"))
        // Two people married into the same family have no blood between them at all.
        assertNull(term("wife", "mum"))
    }

    /* --------------------------------------------------------------- the chain */

    @Test
    fun `the chain names each person and how they arrive`() {
        // Not up to the grandfather and back down: siblings are derived from the parents they
        // share, so the aunt is one step from the father and the chain says so.
        assertEquals(
            listOf(
                RelationStep("dad", StepKind.PARENT),
                RelationStep("aunt", StepKind.SIBLING),
            ),
            chain("me", "aunt"),
        )
        assertEquals(
            listOf(
                RelationStep("dad", StepKind.PARENT),
                RelationStep("grandad", StepKind.PARENT),
            ),
            chain("me", "grandad"),
        )
    }

    @Test
    fun `a marriage is walked, because in-laws are most of what gets asked`() {
        val relation = Kinship.relate(family(), "me", "wifes-mother") as Relation.Found

        assertEquals(
            listOf(
                RelationStep("wife", StepKind.SPOUSE),
                RelationStep("wifes-mother", StepKind.PARENT),
            ),
            relation.chain,
        )
        assertTrue("no blood between them, so this is a marriage", relation.byMarriage)
        assertNull(relation.term)
    }

    @Test
    fun `a blood route wins over a marriage route of the same length`() {
        // Reaching the aunt through her own husband would be true and useless.
        val snapshot = Builder()
            .person("me", "parent", "aunt", "aunts-husband")
            .parentOf("parent", "me")
            .siblingOf("parent", "aunt")
            .married("aunt", "aunts-husband")
            .married("parent", "aunts-husband")   // an absurd edge, there to bait the search
            .build()

        val relation = Kinship.relate(snapshot, "me", "aunt") as Relation.Found
        assertEquals(listOf(StepKind.PARENT, StepKind.SIBLING), relation.chain.map { it.kind })
    }

    @Test
    fun `siblings are one step, not up to a parent and back down`() {
        assertEquals(listOf(RelationStep("aunt", StepKind.SIBLING)), chain("dad", "aunt"))
    }

    @Test
    fun `the chain and the term agree about who is involved`() {
        val relation = Kinship.relate(family(), "me", "second-line") as Relation.Found

        // The ancestor that names the relationship need not be on the shortest route to it: the
        // two branches join at their siblings, a generation below the ancestor they share.
        assertEquals("great", relation.sharedAncestorId)
        assertEquals(
            listOf("me", "dad", "grandad", "granduncle", "cousin-parent", "second-line"),
            listOf("me") + relation.chain.map { it.personId },
        )
        assertFalse("nobody outside the route is lit up", "kid" in relation.peopleInvolved("me"))
    }

    /* --------------------------------------------------------------- the edges */

    @Test
    fun `the same person twice is said plainly rather than answered with an empty chain`() {
        assertEquals(Relation.SamePerson, Kinship.relate(family(), "me", "me"))
    }

    @Test
    fun `two families in one file are not related to each other`() {
        val snapshot = Builder()
            .person("a", "b", "x", "y")
            .parentOf("a", "b")
            .parentOf("x", "y")
            .build()

        assertEquals(Relation.Unrecorded, Kinship.relate(snapshot, "b", "y"))
    }

    @Test
    fun `somebody who is not in the tree is unrecorded, not a crash`() {
        assertEquals(Relation.Unrecorded, Kinship.relate(family(), "me", "ghost"))
        assertEquals(Relation.Unrecorded, Kinship.relate(family(), "ghost", "me"))
        assertEquals(Relation.Unrecorded, Kinship.relate(FamilySnapshot.Empty, "a", "b"))
    }

    @Test
    fun `a cycle in bad data terminates rather than hanging`() {
        // Rejected when created, but a corrupt import must not be able to spin the search forever.
        val snapshot = Builder()
            .person("a", "b", "c")
            .parentOf("a", "b").parentOf("b", "c").parentOf("c", "a")
            .build()

        assertTrue(Kinship.relate(snapshot, "a", "c") is Relation.Found)
    }

    @Test
    fun `a long line is answered in reasonable time`() {
        val builder = Builder()
        builder.person("p0")
        repeat(2000) {
            builder.person("p${it + 1}").parentOf("p$it", "p${it + 1}")
        }
        val snapshot = builder.build()

        val started = System.currentTimeMillis()
        val relation = Kinship.relate(snapshot, "p0", "p2000") as Relation.Found
        val elapsed = System.currentTimeMillis() - started

        assertEquals(KinshipTerm.Descendant(2000), relation.term)
        assertTrue("took ${elapsed}ms", elapsed < 2000)
    }

    /*
     * A SIBLING edge is recorded exactly when the parents are unknown, so these cases have no
     * ancestor to measure through until one is stood in for them. Caught on a device: an aunt
     * reachable only through her brother came back as merely "related".
     */

    @Test
    fun `an aunt known only as somebody's sister is still an aunt`() {
        val snapshot = Builder()
            .person("me", "dad", "aunt")
            .parentOf("dad", "me")
            .siblingOf("dad", "aunt")
            .build()

        val relation = Kinship.relate(snapshot, "me", "aunt") as Relation.Found

        assertEquals(KinshipTerm.ParentsSibling(greats = 0), relation.term)
        assertFalse("blood, not marriage", relation.byMarriage)
    }

    @Test
    fun `the stand-in ancestor is not a person, so nothing can try to name it`() {
        val snapshot = Builder()
            .person("elder", "younger")
            .siblingOf("elder", "younger")
            .build()

        val relation = Kinship.relate(snapshot, "elder", "younger") as Relation.Found

        assertEquals(KinshipTerm.Sibling, relation.term)
        assertFalse(relation.sharedAncestorId in snapshot.people)
        assertEquals("the chain still crosses one edge, not two", 1, relation.steps)
    }

    @Test
    fun `three siblings on two edges share one unrecorded parent, not two`() {
        // Minting a stand-in per edge rather than per group would make the outer two cousins.
        val snapshot = Builder()
            .person("a", "b", "c")
            .siblingOf("a", "b").siblingOf("b", "c")
            .build()

        assertEquals(
            KinshipTerm.Sibling,
            (Kinship.relate(snapshot, "a", "c") as Relation.Found).term,
        )
    }

    @Test
    fun `an explicit edge does not overrule the parents when both are recorded`() {
        val snapshot = Builder()
            .person("mum", "one", "two")
            .parentOf("mum", "one").parentOf("mum", "two")
            .siblingOf("one", "two")
            .build()

        val relation = Kinship.relate(snapshot, "one", "two") as Relation.Found

        assertEquals(KinshipTerm.Sibling, relation.term)
        assertEquals("measured through the mother who is actually recorded", "mum", relation.sharedAncestorId)
    }

    /* -------------------------------------------------- what a chart needs to draw the answer */

    @Test
    fun `drawing two siblings needs the parent they are derived from`() {
        // Siblings are derived from a shared parent, so the sibling step carries no edge of its
        // own. Drawn without him, an aunt and a father are two loose cards with nothing between.
        val snapshot = Builder()
            .person("me", "dad", "aunt", "grandad")
            .parentOf("grandad", "dad").parentOf("grandad", "aunt")
            .parentOf("dad", "me")
            .build()

        val relation = Kinship.relate(snapshot, "me", "aunt") as Relation.Found

        assertEquals(
            "the chain itself says nothing about the grandfather",
            setOf("me", "dad", "aunt"),
            relation.peopleInvolved("me"),
        )
        assertEquals(
            "but the chart cannot join the two of them without him",
            setOf("me", "dad", "aunt", "grandad"),
            relation.peopleToDraw(snapshot, "me"),
        )
    }

    @Test
    fun `an explicit sibling edge needs nobody added, because it draws its own bracket`() {
        val snapshot = Builder()
            .person("me", "dad", "aunt")
            .parentOf("dad", "me")
            .siblingOf("dad", "aunt")
            .build()

        val relation = Kinship.relate(snapshot, "me", "aunt") as Relation.Found

        assertEquals(setOf("me", "dad", "aunt"), relation.peopleToDraw(snapshot, "me"))
    }

    @Test
    fun `nobody off the line is dragged in`() {
        val snapshot = Builder()
            .person("me", "dad", "mum", "grandad", "granny", "stranger")
            .parentOf("dad", "me").parentOf("mum", "me")
            .parentOf("grandad", "dad").parentOf("granny", "dad")
            .married("dad", "mum").married("grandad", "granny")
            .person("cousin").parentOf("grandad", "uncle").person("uncle")
            .parentOf("uncle", "cousin")
            .build()

        val drawn = (Kinship.relate(snapshot, "me", "grandad") as Relation.Found)
            .peopleToDraw(snapshot, "me")

        assertEquals(setOf("me", "dad", "grandad"), drawn)
        listOf("mum", "granny", "stranger", "uncle", "cousin").forEach {
            assertFalse("$it is not on the line and must not be drawn", it in drawn)
        }
    }

    @Test
    fun `the drawn people still form one connected chart`() {
        val snapshot = Builder()
            .person("me", "dad", "aunt", "grandad", "noise-a", "noise-b")
            .parentOf("grandad", "dad").parentOf("grandad", "aunt")
            .parentOf("dad", "me")
            .parentOf("noise-a", "noise-b")
            .build()

        val drawn = (Kinship.relate(snapshot, "me", "aunt") as Relation.Found)
            .peopleToDraw(snapshot, "me")
        val cut = snapshot.restrictedTo(drawn)

        assertEquals(drawn.size, cut.people.size)
        assertEquals("only edges with both ends still present", 3, cut.parentEdges.size)
        // One family, not four loose cards: the whole point of keeping the shared parent.
        val layout = WholeTreeLayoutEngine.layout(cut)
        assertEquals(0, layout.unconnectedCount)
        assertEquals(
            "and it reads top-down: grandfather, then his children, then me",
            3,
            layout.generations,
        )
    }
}
