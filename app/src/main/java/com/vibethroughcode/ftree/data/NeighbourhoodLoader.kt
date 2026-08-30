package com.vibethroughcode.ftree.data

import com.vibethroughcode.ftree.graph.FamilySnapshot

/**
 * Loads the slice of the tree the chart needs, and no more.
 *
 * Walks outwards from one person a generation at a time, asking for each ring in a single batched
 * query. The cost is proportional to what will be drawn rather than to the size of the family, so a
 * tree of thousands opens as fast as a tree of ten.
 */
class NeighbourhoodLoader(
    private val people: PersonDao,
    private val relationships: RelationshipDao,
) {

    suspend fun load(focusId: String, generationsUp: Int, generationsDown: Int): FamilySnapshot {
        if (people.findById(focusId) == null) return FamilySnapshot.Empty

        val ids = linkedSetOf(focusId)

        // Upwards. One extra ring is walked so the focus's siblings can be found through the
        // parents they share.
        var frontier = listOf(focusId)
        val parentsOfFocus = chunked(frontier) { relationships.parentIdsOfAll(it) }
        repeat(generationsUp) {
            if (frontier.isEmpty()) return@repeat
            val parents = chunked(frontier) { relationships.parentIdsOfAll(it) }
            ids += parents
            frontier = parents.filterNot { it == focusId }
        }

        // The focus's siblings share the row, so they come from the parents just found.
        if (parentsOfFocus.isNotEmpty()) {
            ids += chunked(parentsOfFocus) { relationships.childIdsOfAll(it) }
        }

        // Downwards, from the focus alone.
        frontier = listOf(focusId)
        repeat(generationsDown) {
            if (frontier.isEmpty()) return@repeat
            val children = chunked(frontier) { relationships.childIdsOfAll(it) }
            ids += children
            frontier = children
        }

        // Partners of everyone on the chart.
        ids += chunked(ids.toList()) { relationships.spouseIdsOfAll(it) }

        val loaded = chunked(ids.toList()) { people.findByIds(it) }.associateBy { it.id }
        val edges = chunked(ids.toList()) { relationships.edgesAmong(it) }
            .distinctBy { it.id }
            .filter { it.fromPersonId in loaded && it.toPersonId in loaded }

        return FamilySnapshot(
            people = loaded,
            parentEdges = edges.filter { it.type == RelationshipType.PARENT }
                .map { it.fromPersonId to it.toPersonId },
            spouseEdges = edges.filter { it.type == RelationshipType.SPOUSE }
                .map { it.fromPersonId to it.toPersonId },
            siblingEdges = edges.filter { it.type == RelationshipType.SIBLING }
                .map { it.fromPersonId to it.toPersonId },
        )
    }

    /**
     * SQLite caps how many values an `IN` clause can bind, so large id sets are queried in slices.
     */
    private suspend fun <T> chunked(ids: List<String>, query: suspend (List<String>) -> List<T>): List<T> =
        if (ids.size <= CHUNK) query(ids)
        else ids.chunked(CHUNK).flatMap { query(it) }

    private companion object {
        const val CHUNK = 900
    }
}
