package com.vibethroughcode.ftree.graph

import com.vibethroughcode.ftree.data.Person
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class TreeLayoutEngineTest {

    /** Builds a snapshot from a compact description of a family. */
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

    private fun TreeLayout.levelOf(id: String) = node(id)?.level
    private fun TreeLayout.xOf(id: String) = node(id)!!.centerX
    private fun TreeLayout.yOf(id: String) = node(id)!!.centerY

    private fun nuclearFamily() = Builder()
        .person("father", "1962").person("mother", "1965")
        .person("me", "1990").person("sister", "1993")
        .person("wife", "1992").person("child", "2020")
        .married("father", "mother")
        .married("me", "wife")
        .parentOf("father", "me").parentOf("mother", "me")
        .parentOf("father", "sister").parentOf("mother", "sister")
        .parentOf("me", "child").parentOf("wife", "child")
        .build()

    @Test
    fun `an unknown focus lays out nothing rather than throwing`() {
        val layout = TreeLayoutEngine.layout(nuclearFamily(), "nobody")
        assertTrue(layout.isEmpty)
    }

    @Test
    fun `a lone person is a chart of one`() {
        val snapshot = Builder().person("me").build()
        val layout = TreeLayoutEngine.layout(snapshot, "me")

        assertEquals(1, layout.nodes.size)
        assertEquals(0, layout.levelOf("me"))
        assertTrue(layout.width > 0f && layout.height > 0f)
    }

    @Test
    fun `generations sit in their own columns before and after the focus`() {
        val layout = TreeLayoutEngine.layout(nuclearFamily(), "me")

        assertEquals(-1, layout.levelOf("father"))
        assertEquals(-1, layout.levelOf("mother"))
        assertEquals(0, layout.levelOf("me"))
        assertEquals(0, layout.levelOf("sister"))
        assertEquals(0, layout.levelOf("wife"))
        assertEquals(1, layout.levelOf("child"))
    }

    @Test
    fun `a generation shares one x and generations run left to right`() {
        val layout = TreeLayoutEngine.layout(nuclearFamily(), "me")

        assertEquals(layout.node("father")!!.x, layout.node("mother")!!.x, 0.01f)
        assertTrue(layout.node("father")!!.x < layout.node("me")!!.x)
        assertTrue(layout.node("me")!!.x < layout.node("child")!!.x)
    }

    @Test
    fun `partners are placed one above the other, at couple spacing`() {
        val layout = TreeLayoutEngine.layout(nuclearFamily(), "me")

        assertEquals("a couple shares a generation", layout.xOf("me"), layout.xOf("wife"), 0.01f)
        val gap = abs(layout.yOf("me") - layout.yOf("wife"))
        assertEquals(TreeMetrics.NODE_HEIGHT + TreeMetrics.COUPLE_GAP, gap, 0.01f)
    }

    @Test
    fun `no two people in the same generation overlap`() {
        val layout = TreeLayoutEngine.layout(nuclearFamily(), "me")

        layout.nodes.groupBy { it.level }.forEach { (_, column) ->
            column.sortedBy { it.y }.zipWithNext { upper, lower ->
                assertTrue(
                    "${upper.person.id} overlaps ${lower.person.id}",
                    lower.y >= upper.y + TreeMetrics.NODE_HEIGHT - 0.01f,
                )
            }
        }
    }

    @Test
    fun `a couple's children hang from one connector`() {
        val layout = TreeLayoutEngine.layout(nuclearFamily(), "me")

        // father+mother -> me, sister is one family; me+wife -> child is another.
        val toSiblings = layout.descentLinks.first { it.childYs.size == 2 }
        assertEquals(2, toSiblings.childYs.size)
        // The stem leaves from between the two parents.
        val between = layout.yOf("father") to layout.yOf("mother")
        assertTrue(toSiblings.originY > minOf(between.first, between.second))
        assertTrue(toSiblings.originY < maxOf(between.first, between.second))
    }

    @Test
    fun `half-siblings hang from different connectors`() {
        val snapshot = Builder()
            .person("father").person("first").person("second")
            .person("a", "2010").person("b", "2015")
            .married("father", "first").married("father", "second")
            .parentOf("father", "a").parentOf("first", "a")
            .parentOf("father", "b").parentOf("second", "b")
            .build()

        val layout = TreeLayoutEngine.layout(snapshot, "father")

        // Two separate descents, not one bar spanning both children.
        val descents = layout.descentLinks.filter { it.childLeftX > it.originX }
        assertEquals(2, descents.size)
        assertTrue(descents.all { it.childYs.size == 1 })
    }

    @Test
    fun `someone who married twice sits between their partners`() {
        val snapshot = Builder()
            .person("me").person("first").person("second")
            .married("me", "first").married("me", "second")
            .build()

        val layout = TreeLayoutEngine.layout(snapshot, "me")

        val me = layout.yOf("me")
        val a = layout.yOf("first")
        val b = layout.yOf("second")
        assertTrue("expected $me between $a and $b", me > minOf(a, b) && me < maxOf(a, b))
    }

    @Test
    fun `siblings are ordered by birth`() {
        val snapshot = Builder()
            .person("father").person("eldest", "1985").person("me", "1990").person("youngest", "1995")
            .parentOf("father", "eldest").parentOf("father", "me").parentOf("father", "youngest")
            .build()

        val layout = TreeLayoutEngine.layout(snapshot, "me")

        assertTrue(layout.yOf("eldest") < layout.yOf("me"))
        assertTrue(layout.yOf("me") < layout.yOf("youngest"))
    }

    @Test
    fun `a person with no dates still gets a place`() {
        val snapshot = Builder()
            .person("father").person("me", "1990").person("unknownSibling")
            .parentOf("father", "me").parentOf("father", "unknownSibling")
            .build()

        val layout = TreeLayoutEngine.layout(snapshot, "me")
        assertNotNull(layout.node("unknownSibling"))
        assertEquals(0, layout.levelOf("unknownSibling"))
    }

    @Test
    fun `an unnamed ancestor is a node like any other`() {
        val snapshot = Builder()
            .person("me", "1990").person("father", "1962")
            .parentOf("father", "me")
            .apply { people["unknown"] = Person(id = "unknown") }
            .parentOf("unknown", "father")
            .build()

        val layout = TreeLayoutEngine.layout(snapshot, "me")

        assertEquals(-2, layout.levelOf("unknown"))
        assertTrue(layout.node("unknown")!!.person.isUnnamed)
    }

    @Test
    fun `siblings joined only by an explicit edge still share the generation`() {
        val snapshot = Builder()
            .person("me", "1990").person("brother", "1992")
            .siblingOf("me", "brother")
            .build()

        val layout = TreeLayoutEngine.layout(snapshot, "me")
        assertEquals(0, layout.levelOf("brother"))
    }

    @Test
    fun `the generation limit bounds how far the chart reaches`() {
        val builder = Builder()
        // A ten-generation line of descent.
        (0..10).forEach { builder.person("g$it", (1900 + it * 25).toString()) }
        (0 until 10).forEach { builder.parentOf("g$it", "g${it + 1}") }
        val snapshot = builder.build()

        val layout = TreeLayoutEngine.layout(snapshot, "g5", generationsUp = 2, generationsDown = 2)

        assertNotNull(layout.node("g3"))
        assertNotNull(layout.node("g7"))
        assertNull(layout.node("g2"))
        assertNull(layout.node("g8"))
        assertTrue("more generations exist, so the chart says so", layout.truncated)
    }

    @Test
    fun `a fully shown family is not marked truncated`() {
        val layout = TreeLayoutEngine.layout(nuclearFamily(), "me")
        assertFalse(layout.truncated)
    }

    @Test
    fun `cousins are left out because re-focusing reaches them`() {
        val snapshot = Builder()
            .person("grandfather").person("father").person("uncle")
            .person("me").person("cousin")
            .parentOf("grandfather", "father").parentOf("grandfather", "uncle")
            .parentOf("father", "me").parentOf("uncle", "cousin")
            .build()

        val layout = TreeLayoutEngine.layout(snapshot, "me")

        assertNotNull(layout.node("grandfather"))
        assertNotNull(layout.node("father"))
        // The uncle's line would multiply the width without adding to what the chart says.
        assertNull(layout.node("cousin"))
    }

    @Test
    fun `hit testing finds the person under a point and nobody under a gap`() {
        val layout = TreeLayoutEngine.layout(nuclearFamily(), "me")
        val me = layout.node("me")!!

        assertEquals("me", layout.nodeAt(me.centerX, me.centerY)?.person?.id)
        assertNull(layout.nodeAt(me.x - 10f, me.centerY))
        assertNull(layout.nodeAt(me.centerX, me.y - 20f))
    }

    @Test
    fun `re-focusing on a relative re-centres the chart on them`() {
        val snapshot = nuclearFamily()

        val onMe = TreeLayoutEngine.layout(snapshot, "me")
        val onFather = TreeLayoutEngine.layout(snapshot, "father")

        assertEquals(0, onFather.levelOf("father"))
        assertEquals(1, onFather.levelOf("me"))
        // The father's grandchild is now two generations down and still on the chart.
        assertEquals(2, onFather.levelOf("child"))
        assertEquals(-1, onMe.levelOf("father"))
    }

    @Test
    fun `the same family always lays out the same way`() {
        val snapshot = nuclearFamily()

        val first = TreeLayoutEngine.layout(snapshot, "me")
        val second = TreeLayoutEngine.layout(snapshot, "me")

        // A chart that reshuffles its couples between two identical runs -- on rotation, say --
        // is disorienting for no reason.
        assertEquals(
            first.nodes.map { it.person.id to it.x },
            second.nodes.map { it.person.id to it.x },
        )
    }

    @Test
    fun `cards grow with the reader's text size`() {
        val snapshot = nuclearFamily()

        val normal = TreeLayoutEngine.layout(snapshot, "me")
        val (wide, tall) = TreeMetrics.nodeSizeFor(1.8f)
        val large = TreeLayoutEngine.layout(snapshot, "me", nodeWidth = wide, nodeHeight = tall)

        assertTrue(large.node("me")!!.width > normal.node("me")!!.width)
        assertTrue(large.height > normal.height)
        // And nothing overlaps at the larger size either.
        large.nodes.groupBy { it.level }.forEach { (_, column) ->
            column.sortedBy { it.y }.zipWithNext { upper, lower ->
                assertTrue(lower.y >= upper.y + upper.height - 0.01f)
            }
        }
    }

    /**
     * A man who married twice, with three children by each and grandchildren under all of them —
     * the shape that put a stem in mid-air on a real family record.
     */
    private fun twoMarriages(): FamilySnapshot {
        val builder = Builder()
            .person("father", "1900").person("first", "1902").person("second", "1906")
            .married("father", "first").married("father", "second")
        var grandchild = 0
        listOf(
            "first" to listOf("a1" to "1925", "a2" to "1927", "a3" to "1929"),
            "second" to listOf("b1" to "1931", "b2" to "1933", "b3" to "1935"),
        ).forEach { (wife, children) ->
            children.forEach { (id, born) ->
                builder.person(id, born).parentOf("father", id).parentOf(wife, id)
                repeat(4) {
                    val child = "g${grandchild++}"
                    builder.person(child, "1955").parentOf(id, child)
                }
            }
        }
        return builder.build()
    }

    @Test
    fun `a descent bar reaches the parents it descends from`() {
        val layout = TreeLayoutEngine.layout(twoMarriages(), "father", generationsDown = 2)

        val marriages = layout.descentLinks.filter { "father" in it.parentIds }
        assertEquals("one connector per marriage", 2, marriages.size)

        marriages.forEach { link ->
            // The case that matters: the couple's midpoint is outside the run of their own
            // children, because a child's subtree pushed the run clear of them.
            assertTrue(
                "fixture no longer reproduces the stranded stem",
                link.originY < link.childYs.min() || link.originY > link.childYs.max(),
            )
            assertTrue("bar does not reach the stem", link.originY in link.barStart..link.barEnd)
            link.childYs.forEach {
                assertTrue("bar does not reach a child", it in link.barStart..link.barEnd)
            }
        }
    }

    @Test
    fun `every descent bar spans its stem and all of its children`() {
        val layout = TreeLayoutEngine.layout(nuclearFamily(), "me")
        assertTrue(layout.descentLinks.isNotEmpty())
        layout.descentLinks.forEach { link ->
            assertTrue(link.originY in link.barStart..link.barEnd)
            link.childYs.forEach { assertTrue(it in link.barStart..link.barEnd) }
        }
    }

    @Test
    fun `a connector names the people at both of its ends`() {
        val layout = TreeLayoutEngine.layout(nuclearFamily(), "me")
        val mine = layout.descentLinks.single { "child" in it.childIds }

        assertEquals(setOf("me", "wife"), mine.parentIds.toSet())
        assertTrue(mine.touches("me"))
        assertTrue(mine.touches("child"))
        assertFalse("a connector must not claim somebody it does not join", mine.touches("sister"))
    }

    @Test
    fun `a stub matches the child beside it`() {
        val layout = TreeLayoutEngine.layout(twoMarriages(), "father", generationsDown = 2)
        layout.descentLinks.forEach { link ->
            assertEquals(link.childYs.size, link.childIds.size)
            link.childIds.forEachIndexed { index, id ->
                // The ids are carried in the same order as the stubs, so a stub and the card
                // beside it can be matched up rather than assumed to correspond.
                assertEquals(layout.yOf(id), link.childYs[index], 0.01f)
            }
        }
    }

    @Test
    fun `a wide family stays laid out in reasonable time`() {
        val builder = Builder()
        builder.person("root", "1900")
        var previous = listOf("root")
        var id = 0
        repeat(4) { generation ->
            val next = mutableListOf<String>()
            previous.forEach { parent ->
                repeat(4) {
                    val child = "p${id++}"
                    builder.person(child, (1925 + generation * 25).toString())
                    builder.parentOf(parent, child)
                    next += child
                }
            }
            previous = next
        }

        val snapshot = builder.build()
        val started = System.nanoTime()
        val layout = TreeLayoutEngine.layout(snapshot, "root", generationsDown = 4)
        val millis = (System.nanoTime() - started) / 1_000_000

        assertEquals(1 + 4 + 16 + 64 + 256, layout.nodes.size)
        assertTrue("layout took ${millis}ms", millis < 1_000)

        // Still no overlaps at 256 nodes in the last generation.
        layout.nodes.groupBy { it.level }.forEach { (_, column) ->
            column.sortedBy { it.y }.zipWithNext { upper, lower ->
                assertTrue(lower.y >= upper.y + TreeMetrics.NODE_HEIGHT - 0.01f)
            }
        }
    }
}
