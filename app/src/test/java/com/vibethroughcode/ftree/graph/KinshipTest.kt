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
    fun `a marriage is named where English has a name for it, and only there`() {
        // These three used all to come back as "related by marriage", which said nothing about any
        // of them and the same nothing about all of them.
        assertEquals(KinshipTerm.Spouse, term("me", "wife"))
        assertEquals(KinshipTerm.OfSpouse(KinshipTerm.Ancestor(1)), term("me", "wifes-mother"))
        // And read the other way round, a mother-in-law.
        assertEquals(KinshipTerm.OfSpouse(KinshipTerm.Ancestor(1)), term("wife", "mum"))
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
        // No blood between them, but the marriage is at the end of the line, so it has a name.
        assertEquals(KinshipTerm.OfSpouse(KinshipTerm.Ancestor(1)), relation.term)
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

    /* ------------------------------------------------------- relationships through a marriage */

    /*
     * Reported against a real tree: the wife of somebody's father's cousin came back as "related by
     * marriage", which is both awkward and useless — every relative anybody had married into the
     * family got the same flat phrase. A marriage at one end of the line is nameable; one in the
     * middle is not, and saying nothing is the honest answer there.
     */

    private fun married() = Builder()
        .person("me", "wife", "dad", "mum", "grandad", "uncle", "uncles-wife", "sister",
            "sisters-husband", "son", "sons-wife", "wifes-mother", "wifes-brother", "cousin",
            "cousins-wife", "stepmum")
        .married("me", "wife")
        .parentOf("dad", "me").parentOf("mum", "me")
        .parentOf("grandad", "dad").parentOf("grandad", "uncle")
        .married("uncle", "uncles-wife")
        .parentOf("dad", "sister").parentOf("mum", "sister")
        .married("sister", "sisters-husband")
        .parentOf("me", "son").married("son", "sons-wife")
        .parentOf("wifes-mother", "wife").parentOf("wifes-mother", "wifes-brother")
        .parentOf("uncle", "cousin").parentOf("uncles-wife", "cousin")
        .married("cousin", "cousins-wife")
        .married("dad", "stepmum")
        .build()

    private fun termOf(from: String, to: String) =
        (Kinship.relate(married(), from, to) as Relation.Found).term

    @Test
    fun `somebody married to the subject is named, not called a marriage`() {
        assertEquals(KinshipTerm.Spouse, termOf("me", "wife"))
        assertEquals(KinshipTerm.Spouse, termOf("wife", "me"))
    }

    @Test
    fun `a marriage at the far end of the line takes the name of who it married`() {
        assertEquals(KinshipTerm.SpouseOf(KinshipTerm.ParentsSibling(0)), termOf("me", "uncles-wife"))
        assertEquals(KinshipTerm.SpouseOf(KinshipTerm.Sibling), termOf("me", "sisters-husband"))
        assertEquals(KinshipTerm.SpouseOf(KinshipTerm.Descendant(1)), termOf("me", "sons-wife"))
        assertEquals(KinshipTerm.SpouseOf(KinshipTerm.Ancestor(1)), termOf("me", "stepmum"))
        // No word in English for this one, but it still says exactly who she married.
        assertEquals(KinshipTerm.SpouseOf(KinshipTerm.Cousin(1, 0)), termOf("me", "cousins-wife"))
    }

    @Test
    fun `a marriage at the near end names a relative of the subject's own spouse`() {
        assertEquals(KinshipTerm.OfSpouse(KinshipTerm.Ancestor(1)), termOf("me", "wifes-mother"))
        assertEquals(KinshipTerm.OfSpouse(KinshipTerm.Sibling), termOf("me", "wifes-brother"))
    }

    @Test
    fun `a marriage in the middle of the line is not named at all`() {
        // "My uncle's wife's mother" is what she is, and no English word says it. The chain does.
        val snapshot = Builder()
            .person("me", "dad", "grandad", "uncle", "uncles-wife", "her-mother")
            .parentOf("dad", "me").parentOf("grandad", "dad").parentOf("grandad", "uncle")
            .married("uncle", "uncles-wife")
            .parentOf("her-mother", "uncles-wife")
            .build()

        val relation = Kinship.relate(snapshot, "me", "her-mother") as Relation.Found

        assertNull("saying nothing beats saying \"related by marriage\"", relation.term)
        assertEquals("but the chain still reaches her", 4, relation.steps)
    }

    @Test
    fun `two marriages on one line are not named either`() {
        val snapshot = Builder()
            .person("me", "wife", "her-brother", "his-wife")
            .married("me", "wife")
            .siblingOf("wife", "her-brother")
            .married("her-brother", "his-wife")
            .build()

        assertNull(Kinship.relate(snapshot, "me", "his-wife").let { (it as Relation.Found).term })
    }

    @Test
    fun `blood still wins when somebody is both a relative and married in`() {
        // Cousins who marry: they are cousins, and that is the truer thing to say.
        val snapshot = Builder()
            .person("me", "dad", "grandad", "uncle", "cousin")
            .parentOf("grandad", "dad").parentOf("grandad", "uncle")
            .parentOf("dad", "me").parentOf("uncle", "cousin")
            .married("me", "cousin")
            .build()

        assertEquals(KinshipTerm.Cousin(1, 0), (Kinship.relate(snapshot, "me", "cousin") as Relation.Found).term)
    }
}
