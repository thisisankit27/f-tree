package com.vibethroughcode.ftree.book

/**
 * Parses each path string once and hands back the same parse after that. Kept apart from the
 * painter, and generic over what a parse is, so the cache itself can be proved on the JVM.
 */
internal class PathCache<P : Any>(private val parse: (String) -> P) {
    private val cache = HashMap<String, P>()

    /** How many distinct strings have been parsed: one per string, however often it is drawn. */
    var parsed = 0
        private set

    operator fun get(d: String): P = cache.getOrPut(d) { parsed++; parse(d) }
}
