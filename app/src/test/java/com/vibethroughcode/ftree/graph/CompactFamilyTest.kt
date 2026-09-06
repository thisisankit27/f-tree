package com.vibethroughcode.ftree.graph

import com.vibethroughcode.ftree.data.Person
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The compact view is a rearrangement of the chart, so most of what matters here is that it says
 * the same thing about the same people — and that a marriage stays a marriage rather than becoming
 * an extra grandparent.
 */
class CompactFamilyTest {

    private class Builder {
        val people = mutableMapOf<String, Person>()
        val parents = mutableListOf<Pair<String, String>>()
        val spouses = mutableListOf<Pair<String, String>>()
        val siblings = mutableListOf<Pair<String, String>>()

        fun person(id: String, born: String? = null) = apply {
            people[id] = Person(id = id, name = id, birthDate = born)
        }

        fun unnamed(id: String) = apply { people[id] = Person(id = id, name = null) }
        fun parentOf(parent: String, child: String) = apply { parents += parent to child }
        fun married(a: String, b: String) = apply { spouses += a to b }
        fun siblingOf(a: String, b: String) = apply { siblings += a to b }

        fun build() = FamilySnapshot(people, parents, spouses, siblings)
    }

    private fun compact(
        snapshot: FamilySnapshot,
        focusId: String,
        up: Int = 3,
        down: Int = 3,
    ): CompactFamily = CompactFamily.from(
        snapshot,
        TreeLayoutEngine.layout(snapshot, focusId, generationsUp = up, generationsDown = down),
    )

    /** Three generations, a second marriage upstairs, and a sibling with a spouse of their own. */
    private fun family() = Builder()
        .person("grandfather", "1935").person("grandmother", "1938")
        .person("stepGrandmother", "1944")
        .person("father", "1962").person("mother", "1965")
        .person("me", "1990").person("sister", "1987").person("wife", "1992")
        .person("brotherInLaw", "1985")
        .person("son", "2018").person("daughter", "2020")
        .married("grandfather", "grandmother")
        .married("grandfather", "stepGrandmother")
        .married("father", "mother")
        .married("me", "wife")
        .married("sister", "brotherInLaw")
        .parentOf("grandfather", "father").parentOf("grandmother", "father")
        .parentOf("father", "me").parentOf("mother", "me")
        .parentOf("father", "sister").parentOf("mother", "sister")
        .parentOf("me", "son").parentOf("wife", "son")
        .parentOf("me", "daughter").parentOf("wife", "daughter")
        .build()

    /** Everybody on a row, in the order they are read across it. */
    private fun CompactFamily.ids(offset: Int) =
        band(offset)?.groups?.flatMap { it.ids }.orEmpty()

    /** Only the people the row's heading counts. */
    private fun CompactFamily.counted(offset: Int) =
        band(offset)?.groups?.flatMap { group -> group.ids.filter { it in group.ofBand } }.orEmpty()

    @Test
    fun `an unknown focus produces nothing rather than throwing`() {
        assertTrue(compact(family(), "nobody").isEmpty)
    }

    @Test
    fun `generations become bands measured from the focus`() {
        val view = compact(family(), "me")

        assertEquals("me", view.focus?.person?.id)
        assertEquals(listOf("grandmother", "grandfather"), view.counted(-2))
        assertEquals(listOf("father", "mother"), view.counted(-1))
        assertEquals(listOf("sister"), view.counted(0))
        assertEquals(listOf("son", "daughter"), view.counted(1))
    }

    @Test
    fun `the focus is shown with whoever they married rather than beside them`() {
        val view = compact(family(), "me")

        assertEquals(listOf("wife"), view.focus?.partners?.map { it.id })
        // The wife is on row zero too, but she belongs to the centre, not to the row of siblings.
        assertTrue("wife" !in view.ids(0))
    }

    @Test
    fun `somebody married into a generation is shown there but not counted as one of it`() {
        val view = compact(family(), "me")

        // Both parents are parents; the heading counts two.
        assertEquals(2, view.band(-1)!!.count)

        // A second marriage upstairs shows the step-grandmother without making her a grandparent.
        val grandparents = view.band(-2)!!
        assertEquals(2, grandparents.count)
        assertEquals(listOf("grandmother", "grandfather", "stepGrandmother"), view.ids(-2))
    }

    @Test
    fun `a second marriage puts the twice-married person between their two spouses`() {
        val group = compact(family(), "me").band(-2)!!.groups.single()

        assertEquals(listOf("grandmother", "grandfather", "stepGrandmother"), group.ids)
        // Every mark drawn is a marriage that happened: the two wives were never wed.
        assertTrue(group.married(0))
        assertTrue(group.married(1))
        assertEquals(2, group.links.size)
    }

    @Test
    fun `two people who never married stand apart rather than joined`() {
        val snapshot = Builder()
            .person("me", "1990")
            .person("son", "2015").person("daughter", "2018")
            .parentOf("me", "son").parentOf("me", "daughter")
            .build()

        val children = compact(snapshot, "me").band(1)!!
        assertEquals(2, children.groups.size)
        assertTrue(children.groups.all { it.links.isEmpty() })
    }

    @Test
    fun `a row of brothers and sisters leads with the sibling, not the person she married`() {
        val view = compact(family(), "me")
        val siblings = view.band(0)!!

        assertEquals(1, siblings.count)
        assertEquals(listOf("sister", "brotherInLaw"), siblings.groups.single().ids)
        assertTrue(siblings.groups.single().married(0))
    }

    @Test
    fun `a band is read oldest first, with undated people last`() {
        val snapshot = Builder()
            .person("me", "1990")
            .person("father", "1960")
            .person("youngest", "2015").person("eldest", "2005").unnamed("undated")
            .parentOf("father", "me")
            .parentOf("me", "youngest").parentOf("me", "eldest").parentOf("me", "undated")
            .build()

        assertEquals(listOf("eldest", "youngest", "undated"), compact(snapshot, "me").ids(1))
    }

    @Test
    fun `an empty generation is left out rather than shown as an empty band`() {
        val snapshot = Builder().person("me", "1990").build()
        val view = compact(snapshot, "me")

        assertEquals("me", view.focus?.person?.id)
        assertTrue(view.bands.isEmpty())
        assertNull(view.band(-1))
        assertNull(view.band(1))
    }

    @Test
    fun `siblings joined only by an explicit edge still share the focus's row`() {
        val snapshot = Builder()
            .person("me", "1990").person("cousinless", "1992")
            .siblingOf("me", "cousinless")
            .build()

        assertEquals(listOf("cousinless"), compact(snapshot, "me").ids(0))
    }

    @Test
    fun `it shows exactly the people the chart draws`() {
        val snapshot = family()
        listOf("me", "father", "grandfather", "sister", "son").forEach { focusId ->
            val layout = TreeLayoutEngine.layout(snapshot, focusId)
            val view = CompactFamily.from(snapshot, layout)

            assertEquals(
                "centred on $focusId",
                layout.nodes.map { it.person.id }.toSet(),
                view.everyone.toSet(),
            )
            // Nobody is drawn twice: a partner belongs to one person, and the centre is not also
            // standing in its own row.
            assertEquals("centred on $focusId", view.everyone.size, view.everyone.toSet().size)
        }
    }

    @Test
    fun `it says when the record continues past what was loaded`() {
        val snapshot = family()

        assertTrue(compact(snapshot, "me", up = 1).truncated)
        assertTrue(!compact(snapshot, "me", up = 3).truncated)
    }
}
