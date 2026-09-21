package com.vibethroughcode.ftree.book

/**
 * Parses each path once - per path data and fill rule, so a parse is never shared between two
 * rules - and hands back the same parse after that. Kept apart from the painter, and generic over
 * what a parse is, so the cache itself can be proved on the JVM.
 */
internal class PathCache<P : Any>(private val parse: (d: String, evenOdd: Boolean) -> P) {
    private val cache = HashMap<Pair<String, Boolean>, P>()

    /** How many distinct paths have been parsed: one each, however often it is drawn. */
    val parsed: Int get() = cache.size

    operator fun get(d: String, evenOdd: Boolean = false): P = cache.getOrPut(d to evenOdd) { parse(d, evenOdd) }
}
