package com.vibethroughcode.ftree.graph

import com.vibethroughcode.ftree.data.Person
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

/**
 * A chart that renders is not the same as a chart that is correct, and the difference is invisible
 * in a screenshot, so the invariants are asserted here: everybody placed exactly once, nobody
 * overlapping anybody on their own row, children below their parents, and the unconnected — the
 * whole reason this view exists — actually on the canvas.
 */
class WholeTreeLayoutEngineTest {

    private class Builder {
        val people = mutableMapOf<String, Person>()
        val parents = mutableListOf<Pair<String, String>>()
        val spouses = mutableListOf<Pair<String, String>>()
        val siblings = mutableListOf<Pair<String, String>>()

        fun person(id: String, born: String? = null) = apply {
            people[id] = Person(id = id, name = id, birthDate = born)
        }

        fun parentOf(parent: String, child: String) = apply { parents += parent to child }
        fun married(a: String, b: String) = apply { spouses += a to b }
        fun siblingOf(a: String, b: String) = apply { siblings += a to b }
        fun build() = FamilySnapshot(people, parents, spouses, siblings)
    }

    /** Two families that share nobody, plus three people no relationship reaches. */
    private fun archive() = Builder()
        .person("grandpa", "1905").person("granny", "1909")
        .person("dad", "1938").person("mum", "1942")
        .person("aunt", "1948")
        .person("me", "1962").person("spouse", "1965")
        .person("kid", "1990")
        .married("grandpa", "granny")
        .married("dad", "mum")
        .married("me", "spouse")
        .parentOf("grandpa", "dad").parentOf("granny", "dad")
        .parentOf("grandpa", "aunt").parentOf("granny", "aunt")
        .parentOf("dad", "me").parentOf("mum", "me")
        .parentOf("me", "kid").parentOf("spouse", "kid")
        // A second family, connected to nothing in the first.
        .person("other-a", "1950").person("other-b", "1952").person("other-kid", "1980")
        .married("other-a", "other-b")
        .parentOf("other-a", "other-kid").parentOf("other-b", "other-kid")
        // Three strangers from the back of a photograph.
        .person("stranger-1", "1930").person("stranger-2").person("stranger-3", "1955")
        .build()

    private fun WholeTreeLayout.rows(): Map<Int, List<WholeTreeNode>> =
        nodes.groupBy { it.y.toInt() }

    @Test
    fun `every person is placed exactly once`() {
        val snapshot = archive()
        val layout = WholeTreeLayoutEngine.layout(snapshot)

        assertEquals(snapshot.people.size, layout.nodes.size)
        assertEquals(snapshot.people.size, layout.nodes.map { it.person.id }.distinct().size)
        snapshot.people.keys.forEach { assertNotNull("$it is missing", layout.node(it)) }
    }

    @Test
    fun `nobody overlaps anybody on their own row`() {
        val layout = WholeTreeLayoutEngine.layout(archive())

        layout.rows().forEach { (_, row) ->
            row.sortedBy { it.x }.zipWithNext { left, right ->
                val gap = right.x - (left.x + TreeMetrics.NODE_WIDTH)
                assertTrue(
                    "${left.person.id} and ${right.person.id} overlap by ${-gap}",
                    gap >= -0.5f,
                )
            }
        }
    }

    @Test
    fun `partners sit closer than neighbours, because the spacing is the notation`() {
        val layout = WholeTreeLayoutEngine.layout(archive())
        val me = layout.node("me")!!
        val spouse = layout.node("spouse")!!

        assertEquals("partners share a row", me.y, spouse.y, 0.01f)
        val between = abs(spouse.x - me.x) - TreeMetrics.NODE_WIDTH
        assertTrue(
            "partners $between apart, which is not closer than the $${TreeMetrics.SIBLING_GAP} " +
                "that separates strangers",
            between <= TreeMetrics.SIBLING_GAP,
        )
    }

    @Test
    fun `children are drawn below their parents`() {
        val snapshot = archive()
        val layout = WholeTreeLayoutEngine.layout(snapshot)

        snapshot.parentEdges.forEach { (parent, child) ->
            val above = layout.node(parent)!!
            val below = layout.node(child)!!
            assertTrue("$child is not below $parent", below.y > above.y)
        }
    }

    @Test
    fun `people no relationship reaches are on the canvas, in their own block`() {
        val layout = WholeTreeLayoutEngine.layout(archive())

        assertEquals(3, layout.unconnectedCount)
        listOf("stranger-1", "stranger-2", "stranger-3").forEach {
            assertNotNull("$it was dropped, which is the one thing this view must not do",
                layout.node(it))
            assertEquals(-1, layout.node(it)!!.level)
        }

        val block = layout.groups.single { it.unconnected }
        assertEquals(3, block.memberCount)
    }

    @Test
    fun `separate families get their own frames`() {
        val layout = WholeTreeLayoutEngine.layout(archive())
        val families = layout.groups.filter { !it.unconnected }

        assertEquals(2, families.size)
        assertEquals("the larger family is laid out first", 8, families.first().memberCount)
        assertEquals(3, families.last().memberCount)
    }

    @Test
    fun `a parent sits directly above their earliest child, however deep that child is`() {
        // Longest-path ranking alone would strand the in-law at the top of the chart, trailing a
        // connector the height of it, because their only child married three generations down.
        val snapshot = Builder()
            .person("g1").person("g2").person("g3").person("g4")
            .parentOf("g1", "g2").parentOf("g2", "g3").parentOf("g3", "g4")
            .person("in-law-parent")
            .person("in-law", "1990")
            .parentOf("in-law-parent", "in-law")
            .married("g4", "in-law")
            .build()

        val layout = WholeTreeLayoutEngine.layout(snapshot)
        val inLaw = layout.node("in-law")!!
        val inLawParent = layout.node("in-law-parent")!!

        assertEquals("married pair share a row", layout.node("g4")!!.y, inLaw.y, 0.01f)
        assertEquals(
            "the in-law's parent belongs one row above them, not at the top of the chart",
            inLaw.level - 1,
            inLawParent.level,
        )
    }

    @Test
    fun `a twice-married person sits between their partners`() {
        // Ordered any other way the two wives end up adjacent at couple spacing, and the chart
        // states they were married to each other.
        val snapshot = Builder()
            .person("husband", "1938")
            .person("first-wife", "1942")
            .person("second-wife", "1948")
            .married("husband", "first-wife")
            .married("husband", "second-wife")
            .person("child-a", "1962").person("child-b", "1970")
            .parentOf("husband", "child-a").parentOf("first-wife", "child-a")
            .parentOf("husband", "child-b").parentOf("second-wife", "child-b")
            .build()

        val layout = WholeTreeLayoutEngine.layout(snapshot)
        val husband = layout.node("husband")!!.x
        val first = layout.node("first-wife")!!.x
        val second = layout.node("second-wife")!!.x

        assertTrue(
            "the husband must separate his two wives, not stand beside both of them",
            (first < husband && husband < second) || (second < husband && husband < first),
        )
    }

    @Test
    fun `half-siblings hang from their own descent, not a shared one`() {
        val snapshot = Builder()
            .person("dad").person("mum-one").person("mum-two")
            .married("dad", "mum-one").married("dad", "mum-two")
            .person("full-a").person("full-b").person("half")
            .parentOf("dad", "full-a").parentOf("mum-one", "full-a")
            .parentOf("dad", "full-b").parentOf("mum-one", "full-b")
            .parentOf("dad", "half").parentOf("mum-two", "half")
            .build()

        val layout = WholeTreeLayoutEngine.layout(snapshot)

        // One bar for the first marriage's two children, a separate one for the half-sibling.
        assertEquals(2, layout.descentLinks.size)
        assertEquals(
            listOf(1, 2),
            layout.descentLinks.map { it.childXs.size }.sorted(),
        )
    }

    @Test
    fun `siblings with unknown parents get a bracket, since there is no bar to hang them from`() {
        val snapshot = Builder()
            .person("elder", "1902").person("younger", "1908")
            .siblingOf("elder", "younger")
            .build()

        val layout = WholeTreeLayoutEngine.layout(snapshot)

        assertEquals(1, layout.siblingBrackets.size)
        assertEquals(0, layout.unconnectedCount)
        assertEquals("an explicit sibling edge still makes a family", 1, layout.groups.size)
    }

    @Test
    fun `an empty tree lays out to nothing rather than crashing`() {
        val layout = WholeTreeLayoutEngine.layout(FamilySnapshot.Empty)

        assertTrue(layout.isEmpty)
        assertEquals(0f, layout.width, 0.01f)
        assertNull(layout.node("nobody"))
    }

    @Test
    fun `a tree of only strangers still draws all of them`() {
        val snapshot = Builder()
            .person("a").person("b").person("c").person("d")
            .build()

        val layout = WholeTreeLayoutEngine.layout(snapshot)

        assertEquals(4, layout.nodes.size)
        assertEquals(4, layout.unconnectedCount)
        assertTrue("they must not stack into a single column", layout.width > TreeMetrics.NODE_WIDTH * 1.5f)
    }

    @Test
    fun `an edge naming somebody who is not in the tree is ignored, not fatal`() {
        val snapshot = Builder()
            .person("only")
            .parentOf("only", "ghost")
            .married("only", "phantom")
            .build()

        val layout = WholeTreeLayoutEngine.layout(snapshot)

        assertEquals(1, layout.nodes.size)
        assertNotNull(layout.node("only"))
        assertTrue(layout.descentLinks.isEmpty())
    }

    @Test
    fun `a large tree lays out in reasonable time`() {
        val builder = Builder()
        var id = 0
        val previous = mutableListOf<String>()
        repeat(4) { builder.person("root$it", "1900"); previous += "root$it" }
        repeat(8) { generation ->
            val next = mutableListOf<String>()
            previous.forEach { parent ->
                repeat(2) {
                    val child = "p${id++}"
                    builder.person(child, "${1920 + generation * 25}")
                    builder.parentOf(parent, child)
                    next += child
                }
            }
            previous.clear()
            previous += next.take(40)   // keep the row width sane
        }
        val snapshot = builder.build()

        val started = System.currentTimeMillis()
        val layout = WholeTreeLayoutEngine.layout(snapshot)
        val elapsed = System.currentTimeMillis() - started

        assertEquals(snapshot.people.size, layout.nodes.size)
        assertTrue("layout of ${snapshot.people.size} people took ${elapsed}ms", elapsed < 5000)
    }

    /*
     * The shape that exposed longest-path ranking, taken from a real 148-person tree.
     *
     * One side of the family is written down four generations back; the other stops at a
     * grandfather whose own parents nobody recorded. Ranked by depth from the oldest ancestor, that
     * grandfather is a root and lands on the top row beside the great-great-grandfather — and his
     * children scatter across three rows, each dragged down by however deep their spouse's ancestry
     * ran. Generations are not depths.
     */
    private fun lopsided() = Builder()
        .person("great-great", "1890").person("great", "1915")
        .person("grandfather", "1940").person("grandmother", "1944")
        .person("father", "1968").person("mother", "1972")
        .person("me", "2002")
        // The mother's father, with no ancestry recorded above him at all.
        .person("maternal-grandfather", "1942").person("maternal-grandmother", "1946")
        // ...and the mother's siblings, who married people with no recorded ancestry either.
        .person("uncle", "1970").person("uncles-wife", "1974")
        .person("aunt", "1976").person("aunts-husband", "1973")
        .parentOf("great-great", "great")
        .parentOf("great", "grandfather")
        .parentOf("grandfather", "father").parentOf("grandmother", "father")
        .parentOf("father", "me").parentOf("mother", "me")
        .parentOf("maternal-grandfather", "mother").parentOf("maternal-grandmother", "mother")
        .parentOf("maternal-grandfather", "uncle").parentOf("maternal-grandmother", "uncle")
        .parentOf("maternal-grandfather", "aunt").parentOf("maternal-grandmother", "aunt")
        .married("grandfather", "grandmother").married("maternal-grandfather", "maternal-grandmother")
        .married("father", "mother").married("uncle", "uncles-wife").married("aunt", "aunts-husband")
        .build()

    @Test
    fun `both grandfathers stand on one row, however far back either line is recorded`() {
        val layout = WholeTreeLayoutEngine.layout(lopsided())

        assertEquals(
            "a grandfather is a grandfather; how much survives above him cannot move his row",
            layout.node("grandfather")!!.level,
            layout.node("maternal-grandfather")!!.level,
        )
        assertEquals(
            "and he belongs one row above his own daughter, not four",
            layout.node("mother")!!.level - 1,
            layout.node("maternal-grandfather")!!.level,
        )
    }

    @Test
    fun `siblings share a row whoever each of them married`() {
        val layout = WholeTreeLayoutEngine.layout(lopsided())

        val rows = listOf("mother", "uncle", "aunt").map { layout.node(it)!!.level }
        assertEquals("three siblings, one generation, one row", 1, rows.distinct().size)
    }

    @Test
    fun `every parent is exactly one row above every child`() {
        val snapshot = lopsided()
        val layout = WholeTreeLayoutEngine.layout(snapshot)

        snapshot.parentEdges.forEach { (parent, child) ->
            assertEquals(
                "$child should sit exactly one row below $parent",
                layout.node(parent)!!.level + 1,
                layout.node(child)!!.level,
            )
        }
    }

    @Test
    fun `a marriage that contradicts the generations still draws downward`() {
        // Somebody married to their own aunt: one route says "same row", another "one row apart",
        // and nothing satisfies both. The parent edges are what must not invert.
        val snapshot = Builder()
            .person("grandparent").person("parent").person("aunt").person("child")
            .parentOf("grandparent", "parent").parentOf("grandparent", "aunt")
            .parentOf("parent", "child")
            .married("child", "aunt")
            .build()

        val layout = WholeTreeLayoutEngine.layout(snapshot)

        snapshot.parentEdges.forEach { (parent, child) ->
            assertTrue(
                "$child is not below $parent",
                layout.node(child)!!.level > layout.node(parent)!!.level,
            )
        }
    }
}
