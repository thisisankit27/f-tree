package com.vibethroughcode.ftree.graph

import com.vibethroughcode.ftree.data.Person

/**
 * A bounded slice of the family graph, already loaded.
 *
 * The chart never asks for the whole tree — it asks for the people within a few generations of one
 * person. Holding that slice as plain data keeps the layout a pure function of its input, which is
 * what makes it testable on the JVM and safe to run off the main thread.
 */
data class FamilySnapshot(
    val people: Map<String, Person>,
    /** parent id to child id. */
    val parentEdges: List<Pair<String, String>>,
    val spouseEdges: List<Pair<String, String>>,
    val siblingEdges: List<Pair<String, String>>,
) {
    val parentsOf: Map<String, List<String>> =
        parentEdges.groupBy({ it.second }, { it.first })

    val childrenOf: Map<String, List<String>> =
        parentEdges.groupBy({ it.first }, { it.second })

    val spousesOf: Map<String, List<String>> =
        (spouseEdges + spouseEdges.map { it.second to it.first })
            .groupBy({ it.first }, { it.second })
            .mapValues { (_, v) -> v.distinct() }

    /**
     * Siblings, derived from shared parents and unioned with any explicit edges — the same rule the
     * database uses, so the chart and the person page never disagree.
     */
    val siblingsOf: Map<String, List<String>> = buildMap<String, MutableSet<String>> {
        childrenOf.values.forEach { children ->
            children.forEach { child ->
                getOrPut(child) { mutableSetOf() }.addAll(children.filter { it != child })
            }
        }
        siblingEdges.forEach { (a, b) ->
            getOrPut(a) { mutableSetOf() }.add(b)
            getOrPut(b) { mutableSetOf() }.add(a)
        }
    }.mapValues { (_, v) -> v.toList() }

    companion object {
        val Empty = FamilySnapshot(emptyMap(), emptyList(), emptyList(), emptyList())
    }
}
