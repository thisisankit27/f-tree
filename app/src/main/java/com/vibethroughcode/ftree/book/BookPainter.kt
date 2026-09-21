package com.vibethroughcode.ftree.book

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import androidx.core.graphics.PathParser
import androidx.core.graphics.withSave
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Draws a [Book]'s pages onto an [android.graphics.Canvas] - the Android twin of `site/book/svg.js`.
 *
 * It makes no layout decision: every position, size and line break arrived decided, and a page that
 * looks wrong here looks wrong on the desktop too. The one liberty it takes is the one the format
 * allows (docs/family-book.md): a line of text its own font engine measures wider than the width
 * the composer gave it is shrunk to fit, never grown. For Latin that never happens; for a
 * Devanagari conjunct it can, by a few per cent.
 *
 * The same painter draws the preview and the PDF, so what the reader sees before sharing is what
 * the file holds. Units are PostScript points; the preview scales the canvas, the PDF page is
 * already in points.
 *
 * Where each `svg.js` construct is drawn here, so a change to one is easy to carry to the other:
 *
 * | svg.js                                          | here                                            |
 * |-------------------------------------------------|-------------------------------------------------|
 * | `paintPage`'s format check                      | [readBook] refuses the book before it gets here |
 * | `<rect rx>` / `<circle>` / `<path fill-rule>`    | [draw], `Item.Rect` / `Item.Circle` / `Item.Path` |
 * | `fillAttr`, `gradient` (userSpaceOnUse)         | [fillPaint], [shaderFor], in the current matrix |
 * | `gradient` with `units: 'item'`                 | [shaderFor], a RadialGradient per circle        |
 * | `stroke()`: width, dasharray, linecap, linejoin | [strokePaint]                                   |
 * | `opacity` on an item                            | [alphaOf] on the item's paint                   |
 * | `transform="matrix(...)"` on a `<g>`            | `concat` with [matrixOf]                        |
 * | `opacity` on a `<g>` (group or use)             | [drawNested]: one saveLayerAlpha                |
 * | `clip-path` on a group, inside its transform    | [drawNested]: save, concat, clipPath            |
 * | `<text>` + `fitText`                            | [drawText], shrinking into `w`                  |
 * | `<image>` + `preserveAspectRatio slice`, clip   | [drawImage]                                     |
 * | `expand`: a use written out inline              | [draw] `Item.Use`: the symbol's items, drawn    |
 * | `expand`'s MAX_SYMBOL_DEPTH throw               | [draw] `Item.Use`'s depth check                 |
 * | `silhouette()`                                  | [fillPaint] / [strokePaint]'s `silhouette`      |
 * | (none: SVG parses each `d` itself)              | [paths], each path's data parsed once           |
 *
 * @param fonts font file key (`book_display`, ...) to its typeface
 * @param photo a person's portrait at the size the book asked for, or null to leave the ring bare
 */
class BookPainter(
    private val fonts: Map<String, Typeface>,
    private val photo: (String) -> Bitmap?,
) {
    /** How many lines had to be shrunk to fit, for the tests. Latin text should never need it. */
    var shrunkLines = 0
        private set

    /**
     * Every path and clip, parsed once for the life of this painter: a lamp drawn forty times
     * across a book is parsed once, not forty times. Keyed by the path data and its fill rule, so
     * a parse is never shared between two rules, and two symbols that happen to share a shape
     * share its parse too.
     */
    private val paths = PathCache<Path> { d, evenOdd ->
        PathParser.createPathFromPathData(d).apply { fillType = if (evenOdd) Path.FillType.EVEN_ODD else Path.FillType.WINDING }
    }

    /** How many distinct paths have been parsed, for the tests: the cache must hit. */
    val pathsParsed: Int get() = paths.parsed

    /*
     * One fill and one stroke paint, reset for every shape: a page expands to thousands of items.
     * Reuse is safe because a Canvas - a PdfDocument page's, or a Picture's while it records -
     * copies a paint when it draws with it.
     */
    private val shapeFill = Paint()
    private val shapeStroke = Paint()

    /** Each user-space gradient's shader, built once. Item-relative ones differ per circle. */
    private val shaders = HashMap<Gradient, Shader>()

    /** Scratch for [matrixOf]; concat copies it, so one is enough however deep the nesting. */
    private val matrix = Matrix()
    private val matrixValues = FloatArray(9).also { it[8] = 1f }

    fun paint(canvas: Canvas, book: Book, pageIndex: Int) {
        book.pages[pageIndex].items.forEach { draw(canvas, book, it, null, 0) }
    }

    /**
     * @param silhouette inside a `use` with a `fill`, the one colour every fill and stroke takes
     *   (Ankit's rule, 2026-09-21); null otherwise. The outermost silhouette wins, as svg.js's does.
     * @param depth how many symbols deep this item is drawn
     */
    private fun draw(canvas: Canvas, book: Book, item: Item, silhouette: Colour?, depth: Int) {
        when (item) {
            is Item.Rect -> {
                val box = RectF(item.x, item.y, item.x + item.w, item.y + item.h)
                val r = item.r
                fun drawWith(paint: Paint) = if (r != null) canvas.drawRoundRect(box, r, r, paint) else canvas.drawRect(box, paint)
                fillPaint(book, item.fill, item.op, silhouette)?.let(::drawWith)
                strokePaint(item.stroke, item.sw, item.dash, null, null, item.op, silhouette)?.let(::drawWith)
            }
            is Item.Circle -> {
                fillPaint(book, item.fill, item.op, silhouette, circle = item)?.let { canvas.drawCircle(item.cx, item.cy, item.r, it) }
                strokePaint(item.stroke, item.sw, item.dash, null, null, item.op, silhouette)?.let { canvas.drawCircle(item.cx, item.cy, item.r, it) }
            }
            is Item.Path -> {
                if (item.d.isEmpty()) return   // the composer's "no lines to draw"
                val path = paths[item.d, item.rule == "evenodd"]
                fillPaint(book, item.fill, item.op, silhouette)?.let { canvas.drawPath(path, it) }
                strokePaint(item.stroke, item.sw, item.dash, item.cap, item.join, item.op, silhouette)?.let { canvas.drawPath(path, it) }
            }
            is Item.Text -> drawText(canvas, book, item)
            is Item.Image -> drawImage(canvas, item)
            is Item.Group -> drawNested(canvas, book, item.tf, item.clip, item.op, item.items, silhouette, depth)
            is Item.Use -> {
                // readBook refused a book that could get here; this is the painter's own guard, as
                // svg.js's expand() has, so a hand-built book cannot recurse without end.
                val symbol = book.symbols[item.ref] ?: error("unknown symbol ${item.ref}")
                check(depth < Book.MAX_SYMBOL_DEPTH) { "symbol ${item.ref} is used more than ${Book.MAX_SYMBOL_DEPTH} deep" }
                drawNested(canvas, book, item.tf, null, item.op, symbol.items, silhouette ?: item.fill, depth + 1)
            }
        }
    }

    /**
     * A group, or a symbol drawn by a use: save, concat the transform, clip in the coordinates
     * that leaves, then draw. Opacity applies to the whole as one picture, not to each item in
     * turn - overlapping items inside, or inside a shadow, must not darken where they meet. That
     * is a layer, and withSave's restore takes it down with the rest.
     */
    private fun drawNested(
        canvas: Canvas, book: Book, tf: List<Float>?, clip: String?, op: Float?,
        items: List<Item>, silhouette: Colour?, depth: Int,
    ) {
        canvas.withSave {
            tf?.let { concat(matrixOf(it)) }
            clip?.let { clipPath(paths[it, false]) }
            if (op != null && op < 1f) saveLayerAlpha(null, (op * 255).roundToInt())
            items.forEach { draw(this, book, it, silhouette, depth) }
        }
    }

    /** SVG's `matrix(a b c d e f)` as an android [Matrix], in the one scratch matrix. */
    private fun matrixOf(tf: List<Float>): Matrix {
        matrixValues[0] = tf[0]; matrixValues[1] = tf[2]; matrixValues[2] = tf[4]
        matrixValues[3] = tf[1]; matrixValues[4] = tf[3]; matrixValues[5] = tf[5]
        return matrix.apply { setValues(matrixValues) }
    }

    private fun drawText(canvas: Canvas, book: Book, item: Item.Text) {
        // readBook refuses a book naming a face this app does not carry, so this cannot miss; if
        // it ever does, the page fails loudly rather than printing without a line of text.
        val key = book.fonts[item.font] ?: error("text font ${item.font} is not in the book's fonts")
        val typeface = fonts[key] ?: error("font $key is not one this painter was given")
        val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.SUBPIXEL_TEXT_FLAG).apply {
            this.typeface = typeface
            textSize = item.size
            textAlign = when (item.align) {
                "middle" -> Paint.Align.CENTER
                "end" -> Paint.Align.RIGHT
                else -> Paint.Align.LEFT
            }
        }
        applyFill(paint, book, item.fill, null)
        paint.alpha = alphaOf(item.op)
        val width = item.w
        if (width != null && width > 0f) {
            val measured = paint.measureText(item.s)
            if (measured > width * 1.005f) {
                paint.textSize = item.size * (width / measured)
                shrunkLines++
            }
        }
        canvas.drawText(item.s, item.x, item.y, paint)
    }

    private fun drawImage(canvas: Canvas, item: Item.Image) {
        val bitmap = photo(item.id) ?: return
        val dst = RectF(item.x, item.y, item.x + item.w, item.y + item.h)
        // Cover the box, cropping the middle - SVG's preserveAspectRatio="xMidYMid slice".
        val scale = maxOf(dst.width() / bitmap.width, dst.height() / bitmap.height)
        val sw = dst.width() / scale
        val sh = dst.height() / scale
        val sx = (bitmap.width - sw) / 2f
        val sy = (bitmap.height - sh) / 2f
        val src = Rect(sx.roundToInt(), sy.roundToInt(), (sx + sw).roundToInt(), (sy + sh).roundToInt())
        canvas.withSave {
            if (item.clip == "circle") {
                clipPath(Path().apply { addCircle(dst.centerX(), dst.centerY(), min(dst.width(), dst.height()) / 2f, Path.Direction.CW) })
            } else {
                clipRect(dst)
            }
            val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply { alpha = alphaOf(item.op) }
            drawBitmap(bitmap, src, dst, paint)
        }
    }

    /**
     * The shared fill paint for a shape, or null for no fill. Under a silhouette any fill, a
     * gradient included, becomes its one solid colour; no fill stays none.
     */
    private fun fillPaint(book: Book, fill: Fill?, op: Float?, silhouette: Colour?, circle: Item.Circle? = null): Paint? {
        fill ?: return null
        return shapeFill.apply {
            reset()
            isAntiAlias = true
            style = Paint.Style.FILL
            if (silhouette != null) color = silhouette.argb else applyFill(this, book, fill, circle)
            alpha = alphaOf(op)
        }
    }

    private fun applyFill(paint: Paint, book: Book, fill: Fill, circle: Item.Circle?) {
        when (fill) {
            is Fill.Solid -> paint.color = fill.colour.argb
            is Fill.Ref -> paint.shader = shaderFor(book.defs[fill.id] ?: error("unknown gradient ${fill.id}"), circle)
        }
    }

    private fun shaderFor(g: Gradient, circle: Item.Circle?): Shader {
        val relativeTo = circle?.takeIf { g.units == "item" }
        if (relativeTo == null) shaders[g]?.let { return it }
        val colours = IntArray(g.stops.size) { i ->
            val s = g.stops[i]
            (((s.opacity.coerceIn(0f, 1f) * 255).roundToInt()) shl 24) or (s.colour.argb and 0xFFFFFF)
        }
        val positions = FloatArray(g.stops.size) { g.stops[it].offset }
        return when {
            g.type == "linear" -> LinearGradient(g.x1, g.y1, g.x2, g.y2, colours, positions, Shader.TileMode.CLAMP)
            relativeTo != null -> RadialGradient(
                relativeTo.cx + g.cx * relativeTo.r, relativeTo.cy + g.cy * relativeTo.r, (g.r * relativeTo.r).coerceAtLeast(0.01f),
                colours, positions, Shader.TileMode.CLAMP,
            )
            else -> RadialGradient(g.cx, g.cy, g.r.coerceAtLeast(0.01f), colours, positions, Shader.TileMode.CLAMP)
        }.also { if (relativeTo == null) shaders[g] = it }
    }

    /**
     * The shared stroke paint for a shape, or null for no stroke. A silhouette colours a stroke
     * that is there, keeping its width, dash, cap and join; it adds none.
     */
    private fun strokePaint(stroke: Colour?, sw: Float?, dash: List<Float>?, cap: String?, join: String?, op: Float?, silhouette: Colour?): Paint? {
        stroke ?: return null
        return shapeStroke.apply {
            reset()
            isAntiAlias = true
            style = Paint.Style.STROKE
            color = (silhouette ?: stroke).argb
            alpha = alphaOf(op)
            strokeWidth = sw ?: 1f
            strokeCap = when (cap) {
                "round" -> Paint.Cap.ROUND
                "square" -> Paint.Cap.SQUARE
                else -> Paint.Cap.BUTT
            }
            strokeJoin = when (join) {
                "round" -> Paint.Join.ROUND
                "bevel" -> Paint.Join.BEVEL
                else -> Paint.Join.MITER
            }
            if (!dash.isNullOrEmpty()) {
                val intervals = if (dash.size % 2 == 0) dash else dash + dash
                pathEffect = DashPathEffect(intervals.toFloatArray(), 0f)
            }
        }
    }

    private fun alphaOf(op: Float?): Int = ((op ?: 1f) * 255f).roundToInt().coerceIn(0, 255)
}
