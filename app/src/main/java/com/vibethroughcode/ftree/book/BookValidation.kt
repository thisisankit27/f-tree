package com.vibethroughcode.ftree.book

/*
 * `validateBook` from `site/book/format.js`, in Kotlin. Everything a painter may rely on, checked
 * once when the book is read, so [BookPainter] never meets a ref that does not resolve, a path it
 * cannot follow or a symbol that reaches itself. Kept in step with the JavaScript by hand, and
 * held to the same books by `BookFormatTest` (the golden book, the format-2 conformance book and
 * a refusal for every rule below).
 *
 * The Kotlin types already refuse what the JavaScript checks by hand: an unknown item type, a
 * colour that is not `#rrggbb`, a silhouette fill that is a gradient, a number that is not one.
 * What is left is what a type cannot say.
 */

private val SYMBOL_ID = Regex("^[A-Za-z0-9][A-Za-z0-9_-]*$")

/** How many numbers each path command takes; a command may repeat them, in whole sets. */
private val PATH_ARGS = mapOf('M' to 2, 'L' to 2, 'H' to 1, 'V' to 1, 'C' to 6, 'Q' to 4, 'Z' to 0)

/*
 * format.js's PATH_TOKEN. JavaScript's `\s` is wider than Java's, so it is spelled out here: the
 * two must accept exactly the same path data, or a book would validate on one side only.
 */
private const val JS_SPACE = "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"
private val PATH_TOKEN = java.util.regex.Pattern.compile("([MLHVCQZ])|(-?(?:[0-9]+\\.?[0-9]*|\\.[0-9]+)(?:[eE]-?[0-9]+)?)|([$JS_SPACE,]+)")

/**
 * Reads path data the way both painters must: a leading M, then only absolute M L H V C Q Z, each
 * with whole sets of finite numbers. Returns the points the path visits (end and control points),
 * or null if a painter could not follow it. `format.js`'s `pathPoints`.
 */
fun pathPoints(d: String): List<Pair<Double, Double>>? {
    val tokens = mutableListOf<Any>()   // Char for a command, Double for a number
    val matcher = PATH_TOKEN.matcher(d)
    var at = 0
    while (at < d.length) {
        matcher.region(at, d.length)
        if (!matcher.lookingAt()) return null
        matcher.group(1)?.let { tokens += it[0] }
        matcher.group(2)?.let {
            val n = it.toDouble()
            if (!n.isFinite()) return null
            tokens += n + 0.0   // -0 and 0 are one point, as `${x},${y}` makes them in JavaScript
        }
        at = matcher.end()
    }
    if (tokens.firstOrNull() != 'M') return null
    val points = mutableListOf<Pair<Double, Double>>()
    var x = 0.0
    var y = 0.0
    var i = 0
    while (i < tokens.size) {
        val cmd = tokens[i++] as? Char ?: return null
        val args = mutableListOf<Double>()
        while (i < tokens.size && tokens[i] is Double) args += tokens[i++] as Double
        val n = PATH_ARGS.getValue(cmd)
        if (if (n == 0) args.isNotEmpty() else args.isEmpty() || args.size % n != 0) return null
        if (n == 0) continue
        for (k in args.indices step n) {
            val a = args.subList(k, k + n)
            when (cmd) {
                'H' -> x = a[0]
                'V' -> y = a[0]
                else -> {
                    for (j in 0 until n - 2 step 2) points += a[j] to a[j + 1]
                    x = a[n - 2]
                    y = a[n - 1]
                }
            }
            points += x to y
        }
    }
    return points
}

/** A clip must enclose something: a path that parses and visits at least three distinct points. */
private fun isClip(d: String): Boolean = pathPoints(d)?.toSet()?.let { it.size >= 3 } ?: false

/**
 * The lowest format that draws this book: 2 once it clips a group, carries symbols or uses one,
 * and 1 for everything else. `format.js`'s `formatOf`.
 */
fun formatOf(book: Book): Int {
    if (book.symbols.isNotEmpty()) return Book.FORMAT_MAX
    fun newer(items: List<Item>): Boolean = items.any {
        it is Item.Use || (it is Item.Group && (it.clip != null || newer(it.items)))
    }
    return if (book.pages.any { newer(it.items) }) Book.FORMAT_MAX else Book.FORMAT
}

/**
 * Everything wrong with [book], as `format.js`'s `validateBook` would list it, plus the one check
 * only a painter can make: every font key the book names is one of [fontKeys], the faces this app
 * embeds. Empty when the book can be drawn exactly.
 */
fun validateBook(book: Book, fontKeys: Set<String>): List<String> {
    val problems = mutableListOf<String>()
    val drawn = formatOf(book)
    if (book.format != drawn) problems += "format ${book.format} is declared, but this book draws as format $drawn"
    if (book.size.w != 595 || book.size.h != 842) problems += "page size is not A4"
    if (book.pages.isEmpty()) problems += "no pages"

    // The one check validateBook cannot make: which faces this release carries. A missing one used
    // to be a silently skipped line of text (#246); now the book is refused and says why.
    for ((role, key) in book.fonts) {
        if (key !in fontKeys) {
            problems += "the \"$role\" text is set in font $key, which this app does not carry " +
                "(it has ${fontKeys.sorted().joinToString(", ")}); update f-tree to make this book"
        }
    }

    // Every lookup by name is a key the book carries: a Kotlin map has no prototype to lend
    // `constructor`, so an unknown name is simply absent.
    fun walk(items: List<Item>, where: String, depth: Int, inSymbol: Boolean) {
        items.forEachIndexed { i, it ->
            val at = "$where item $i"
            if (inSymbol && (it is Item.Text || it is Item.Image)) {
                problems += "$at: type ${typeOf(it)}"
                return@forEachIndexed
            }
            val fill = when (it) {
                is Item.Rect -> it.fill
                is Item.Circle -> it.fill
                is Item.Path -> it.fill
                is Item.Text -> it.fill
                else -> null
            }
            if (fill is Fill.Ref) {
                val gradient = book.defs[fill.id]
                if (gradient == null) problems += "$at: unknown gradient ${fill.id}"
                else if (gradient.units == "item" && it !is Item.Circle) problems += "$at: an item-relative gradient on a ${typeOf(it)}"
            }
            val op = when (it) {
                is Item.Rect -> it.op
                is Item.Circle -> it.op
                is Item.Path -> it.op
                is Item.Text -> it.op
                is Item.Image -> it.op
                is Item.Group -> it.op
                is Item.Use -> it.op
            }
            if (op != null && !(op >= 0f && op <= 1f)) problems += "$at: opacity $op"
            val tf = (it as? Item.Group)?.tf ?: (it as? Item.Use)?.tf
            if (tf != null && tf.size != 6) problems += "$at: transform"
            when (it) {
                // An empty path draws nothing, and the composer writes one where a tree has no lines.
                is Item.Path -> if (it.d != "" && pathPoints(it.d) == null) problems += "$at: path data"
                is Item.Text -> {
                    if (it.font !in book.fonts) problems += "$at: text font ${it.font}"
                    if ('\n' in it.s) problems += "$at: text holds a line break"
                }
                is Item.Image -> if (it.clip != "circle" && it.clip != "rect") problems += "$at: clip ${it.clip}"
                is Item.Group -> {
                    if (depth > 4) problems += "$at: groups nested too deep"
                    if (it.clip != null && !isClip(it.clip)) problems += "$at: clip path data"
                    walk(it.items, at, depth + 1, inSymbol)
                }
                is Item.Use -> if (it.ref !in book.symbols) problems += "$at: unknown symbol ${it.ref}"
                else -> Unit
            }
        }
    }
    book.pages.forEachIndexed { p, page -> walk(page.items, "page ${p + 1}", 0, false) }
    for ((id, symbol) in book.symbols) {
        if (!SYMBOL_ID.matches(id)) problems += "symbol $id: not an id"
        walk(symbol.items, "symbol $id", 0, true)
    }

    /*
     * A symbol may use another, but one that reaches itself would expand forever, and one that
     * nests too deep or multiplies too far would exhaust a PdfDocument. Each symbol is walked once
     * and remembered, as format.js does.
     */
    fun usesOf(items: List<Item>, out: MutableList<String> = mutableListOf()): List<String> {
        for (it in items) {
            if (it is Item.Use && it.ref in book.symbols) out += it.ref
            if (it is Item.Group) usesOf(it.items, out)
        }
        return out
    }
    val cycle = Int.MAX_VALUE
    val levels = HashMap<String, Int>()   // id -> how many symbols deep a use of it reaches
    fun depthOf(id: String, trail: List<String>): Int {
        levels[id]?.let { return it }
        if (id in trail) {
            problems += "symbol $id: used through itself (${(trail + id).joinToString(" -> ")})"
            return cycle
        }
        var deepest = 0
        for (ref in usesOf(book.symbols.getValue(id).items)) deepest = maxOf(deepest, depthOf(ref, trail + id))
        val level = if (deepest == cycle) cycle else 1 + deepest
        levels[id] = level
        return level
    }
    for (id in book.symbols.keys) {
        val d = depthOf(id, emptyList())
        if (d > Book.MAX_SYMBOL_DEPTH && d != cycle) problems += "symbol $id: symbols nested $d deep, more than ${Book.MAX_SYMBOL_DEPTH}"
    }
    if (levels.values.none { it == cycle }) {
        // Doubles, as JavaScript counts: a book that multiplies past a Long must still be refused.
        val sizes = HashMap<String, Double>()   // id -> how many items one use of it expands to
        fun count(items: List<Item>): Double = items.sumOf {
            1.0 + (if (it is Item.Group) count(it.items) else 0.0) +
                (if (it is Item.Use && it.ref in book.symbols) sizes.getOrPut(it.ref) { count(book.symbols.getValue(it.ref).items) } else 0.0)
        }
        book.pages.forEachIndexed { p, page ->
            val n = count(page.items)
            if (n > Book.MAX_EXPANDED_ITEMS) problems += "page ${p + 1}: draws ${n.toLong()} items once expanded, more than ${Book.MAX_EXPANDED_ITEMS}"
        }
    }

    for ((id, g) in book.defs) {
        if (g.type != "linear" && g.type != "radial") problems += "gradient $id: type ${g.type}"
        if (g.units != null && g.units != "item") problems += "gradient $id: units ${g.units}"
        if (g.units == "item" && g.type != "radial") problems += "gradient $id: only radial gradients can be item-relative"
        if (g.stops.size < 2) problems += "gradient $id: stops"
    }
    return problems
}

private fun typeOf(item: Item): String = when (item) {
    is Item.Rect -> "rect"
    is Item.Circle -> "circle"
    is Item.Path -> "path"
    is Item.Text -> "text"
    is Item.Image -> "image"
    is Item.Group -> "group"
    is Item.Use -> "use"
}
