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
    fun `generations sit on their own rows above and below the focus`() {
        val layout = TreeLayoutEngine.layout(nuclearFamily(), "me")

        assertEquals(-1, layout.levelOf("father"))
        assertEquals(-1, layout.levelOf("mother"))
        assertEquals(0, layout.levelOf("me"))
        assertEquals(0, layout.levelOf("sister"))
        assertEquals(0, layout.levelOf("wife"))
        assertEquals(1, layout.levelOf("child"))
    }

    @Test
    fun `a row shares one y and rows are ordered top to bottom`() {
        val layout = TreeLayoutEngine.layout(nuclearFamily(), "me")

        assertEquals(layout.node("father")!!.y, layout.node("mother")!!.y, 0.01f)
        assertTrue(layout.node("father")!!.y < layout.node("me")!!.y)
        assertTrue(layout.node("me")!!.y < layout.node("child")!!.y)
    }

    @Test
    fun `partners are placed side by side`() {
        val layout = TreeLayoutEngine.layout(nuclearFamily(), "me")

        val gap = abs(layout.xOf("me") - layout.xOf("wife"))
        assertEquals(TreeMetrics.NODE_WIDTH + TreeMetrics.COUPLE_GAP, gap, 0.01f)
    }

    @Test
    fun `no two people on the same row overlap`() {
        val layout = TreeLayoutEngine.layout(nuclearFamily(), "me")

        layout.nodes.groupBy { it.level }.forEach { (_, row) ->
            row.sortedBy { it.x }.zipWithNext { left, right ->
                assertTrue(
                    "${left.person.id} overlaps ${right.person.id}",
                    right.x >= left.x + TreeMetrics.NODE_WIDTH - 0.01f,
                )
            }
        }
    }

    @Test
    fun `a couple's children hang from one connector`() {
        val layout = TreeLayoutEngine.layout(nuclearFamily(), "me")

        // father+mother -> me, sister is one family; me+wife -> child is another.
        val toSiblings = layout.descentLinks.first { it.childXs.size == 2 }
        assertEquals(2, toSiblings.childXs.size)
        // The drop starts between the two parents.
        val between = layout.xOf("father") to layout.xOf("mother")
        assertTrue(toSiblings.originX > minOf(between.first, between.second))
        assertTrue(toSiblings.originX < maxOf(between.first, between.second))
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
        val descents = layout.descentLinks.filter { it.childTopY > it.originY }
        assertEquals(2, descents.size)
        assertTrue(descents.all { it.childXs.size == 1 })
    }

    @Test
    fun `someone who married twice sits between their partners`() {
        val snapshot = Builder()
            .person("me").person("first").person("second")
            .married("me", "first").married("me", "second")
            .build()

        val layout = TreeLayoutEngine.layout(snapshot, "me")

        val me = layout.xOf("me")
        val a = layout.xOf("first")
        val b = layout.xOf("second")
        assertTrue("expected $me between $a and $b", me > minOf(a, b) && me < maxOf(a, b))
    }

    @Test
    fun `siblings are ordered by birth`() {
        val snapshot = Builder()
            .person("father").person("eldest", "1985").person("me", "1990").person("youngest", "1995")
            .parentOf("father", "eldest").parentOf("father", "me").parentOf("father", "youngest")
            .build()

        val layout = TreeLayoutEngine.layout(snapshot, "me")

        assertTrue(layout.xOf("eldest") < layout.xOf("me"))
        assertTrue(layout.xOf("me") < layout.xOf("youngest"))
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
    fun `siblings joined only by an explicit edge still share the row`() {
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

        // Still no overlaps at 256 nodes on the bottom row.
        layout.nodes.groupBy { it.level }.forEach { (_, row) ->
            row.sortedBy { it.x }.zipWithNext { left, right ->
                assertTrue(right.x >= left.x + TreeMetrics.NODE_WIDTH - 0.01f)
            }
        }
    }
}
