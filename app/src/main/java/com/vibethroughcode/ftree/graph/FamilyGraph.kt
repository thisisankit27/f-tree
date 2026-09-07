package com.vibethroughcode.ftree.graph

/**
 * Graph algorithms over the family tree.
 *
 * These take an adjacency lookup rather than a database, which keeps them ordinary functions:
 * fast to run, trivial to test, and impossible to accidentally couple to Room. The lookups are
 * `suspend` so the same implementation serves both a live database walk and an in-memory one — a
 * plain lambda satisfies a suspending function type, so callers with data already loaded pay
 * nothing for it.
 */
object FamilyGraph {

    /**
     * Every ancestor of [personId], walking upwards.
     *
     * The visited set makes this safe even if the stored data somehow already contains a cycle, so
     * one bad row can never hang the app.
     */
    suspend fun ancestorsOf(
        personId: String,
        parentsOf: suspend (String) -> List<String>,
    ): Set<String> = reachable(personId, parentsOf)

    /** Everyone reachable downwards from [personId]. */
    suspend fun descendantsOf(
        personId: String,
        childrenOf: suspend (String) -> List<String>,
    ): Set<String> = reachable(personId, childrenOf)

    /**
     * One person, everyone below them, and whoever each of them married.
     *
     * This is what "share Sandeep's family" means: his household and the households under it. It
     * deliberately goes *down* only. Sending somebody a branch should not quietly hand over the
     * sharer's parents, siblings, cousins and in-laws, and a recipient starting their own tree from
     * a relative's file wants the people below that relative, not the whole archive they came from.
     *
     * Partners come along at every level, because a couple is how a family is read and a child
     * arriving without the parent they married is a hole in the story. Their *parents* do not: they
     * are the doorway back into another whole family, which is exactly what this is not for.
     */
    suspend fun branchFrom(
        personId: String,
        childrenOf: suspend (String) -> List<String>,
        spousesOf: suspend (String) -> List<String>,
    ): Set<String> {
        val bloodline = descendantsOf(personId, childrenOf) + personId
        val everyone = LinkedHashSet(bloodline)
        bloodline.forEach { everyone.addAll(spousesOf(it)) }
        return everyone
    }

    /**
     * True when making [parentId] a parent of [childId] would make someone their own ancestor.
     *
     * Genealogically this is nonsense, and structurally it would let a tree walk upwards forever,
     * so it is rejected when the edge is created rather than defended against at every read.
     *
     * Checked by walking *up* from the proposed parent: if the proposed child is already somewhere
     * above them, the edge would close a loop.
     */
    suspend fun wouldCreateAncestorCycle(
        parentId: String,
        childId: String,
        parentsOf: suspend (String) -> List<String>,
    ): Boolean = parentId == childId || childId in ancestorsOf(parentId, parentsOf)

    private suspend fun reachable(
        start: String,
        next: suspend (String) -> List<String>,
    ): Set<String> {
        val found = LinkedHashSet<String>()
        val queue = ArrayDeque(next(start))
        while (queue.isNotEmpty()) {
            val node = queue.removeFirst()
            if (node == start || !found.add(node)) continue
            queue.addAll(next(node))
        }
        return found
    }
}
