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
 * | `fillAttr`, `gradient` (userSpaceOnUse)         | [applyFill], [shaderFor], in the current matrix |
 * | `gradient` with `units: 'item'`                 | [shaderFor], a RadialGradient per circle        |
 * | `stroke()`: width, dasharray, linecap, linejoin | [strokePaint]                                   |
 * | `opacity` on an item                            | [alphaOf] on the item's paint                   |
 * | `transform="matrix(...)"` on a `<g>`            | `concat` with [matrixOf]                        |
 * | `opacity` on a `<g>` (group or use)             | [layer]: one saveLayerAlpha                     |
 * | `clip-path` on a group, inside its transform    | [draw] `Item.Group`: save, concat, clipPath     |
 * | `<text>` + `fitText`                            | [drawText], shrinking into `w`                  |
 * | `<image>` + `preserveAspectRatio slice`, clip   | [drawImage]                                     |
 * | `expand`: a use written out inline              | [draw] `Item.Use`: the symbol's items, drawn    |
 * | `expand`'s MAX_SYMBOL_DEPTH throw               | [draw] `Item.Use`'s depth check                 |
 * | `silhouette()`                                  | the `silhouette` colour passed down [draw]      |
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
     * across a book is parsed once, not forty times. Keyed by the path data, so two symbols
     * that happen to share a shape share its parse too.
     */
    private val paths = PathCache<Path> { d -> PathParser.createPathFromPathData(d) }

    /** How many distinct path strings have been parsed, for the tests: the cache must hit. */
    val pathsParsed: Int get() = paths.parsed

    fun paint(canvas: Canvas, book: Book, pageIndex: Int) {
        val page = book.pages[pageIndex]
        page.items.forEach { draw(canvas, book, it, 1f, null, 0) }
    }

    /**
     * @param silhouette inside a `use` with a `fill`, the one colour every fill and stroke takes
     *   (Ankit's rule, 2026-09-21); null otherwise. The outermost silhouette wins, as svg.js's does.
     * @param depth how many symbols deep this item is drawn
     */
    private fun draw(canvas: Canvas, book: Book, item: Item, inherited: Float, silhouette: Colour?, depth: Int) {
        when (item) {
            is Item.Rect -> {
                val box = RectF(item.x, item.y, item.x + item.w, item.y + item.h)
                fillPaint(book, cast(item.fill, silhouette), item.op, inherited, box)?.let { paint ->
                    if (item.r != null) canvas.drawRoundRect(box, item.r, item.r, paint) else canvas.drawRect(box, paint)
                }
                strokePaint(silhouette.over(item.stroke), item.sw, item.dash, null, null, item.op, inherited)?.let { paint ->
                    if (item.r != null) canvas.drawRoundRect(box, item.r, item.r, paint) else canvas.drawRect(box, paint)
                }
            }
            is Item.Circle -> {
                val box = RectF(item.cx - item.r, item.cy - item.r, item.cx + item.r, item.cy + item.r)
                fillPaint(book, cast(item.fill, silhouette), item.op, inherited, box, circle = item)?.let { canvas.drawCircle(item.cx, item.cy, item.r, it) }
                strokePaint(silhouette.over(item.stroke), item.sw, item.dash, null, null, item.op, inherited)?.let { canvas.drawCircle(item.cx, item.cy, item.r, it) }
            }
            is Item.Path -> {
                if (item.d.isEmpty()) return   // the composer's "no lines to draw"
                val path = paths[item.d]
                // The parse is shared, so the fill rule is set for this drawing, every time.
                path.fillType = if (item.rule == "evenodd") Path.FillType.EVEN_ODD else Path.FillType.WINDING
                val bounds = RectF().also { path.computeBounds(it, true) }
                fillPaint(book, cast(item.fill, silhouette), item.op, inherited, bounds)?.let { canvas.drawPath(path, it) }
                strokePaint(silhouette.over(item.stroke), item.sw, item.dash, item.cap, item.join, item.op, inherited)?.let { canvas.drawPath(path, it) }
            }
            is Item.Text -> drawText(canvas, book, item, inherited)
            is Item.Image -> drawImage(canvas, item, inherited)
            is Item.Group -> {
                canvas.withSave {
                    item.tf?.let { concat(matrixOf(it)) }
                    // Inside the transform: the clip is in the group's own coordinates.
                    item.clip?.let { clip -> clipPath(paths[clip].also { it.fillType = Path.FillType.WINDING }) }
                    layer(this, item.op)
                    item.items.forEach { draw(this, book, it, inherited, silhouette, depth) }
                }
            }
            is Item.Use -> {
                // readBook refused a book that could get here; this is the painter's own guard, as
                // svg.js's expand() has, so a hand-built book cannot recurse without end.
                val symbol = book.symbols[item.ref] ?: error("unknown symbol ${item.ref}")
                check(depth < Book.MAX_SYMBOL_DEPTH) { "symbol ${item.ref} is used more than ${Book.MAX_SYMBOL_DEPTH} deep" }
                canvas.withSave {
                    item.tf?.let { concat(matrixOf(it)) }
                    // The use's op is one layer over everything it draws, never pushed down to the
                    // items: shapes overlapping inside a dimmed lamp, or its shadow, do not darken.
                    layer(this, item.op)
                    val colour = silhouette ?: item.fill
                    symbol.items.forEach { draw(this, book, it, inherited, colour, depth + 1) }
                }
            }
        }
    }

    /**
     * Opacity on a group or a use applies to it as one picture, not to each item in turn -
     * overlapping items inside must not show through each other. That is a layer, and the
     * caller's withSave restore takes it down with the rest.
     */
    private fun layer(canvas: Canvas, op: Float?) {
        val alpha = op ?: 1f
        if (alpha < 1f) canvas.saveLayerAlpha(null, (alpha * 255).roundToInt())
    }

    /** SVG's `matrix(a b c d e f)` as an android [Matrix]. */
    private fun matrixOf(tf: List<Float>): Matrix =
        Matrix().apply { setValues(floatArrayOf(tf[0], tf[2], tf[4], tf[1], tf[3], tf[5], 0f, 0f, 1f)) }

    /** A silhouette turns any fill, a gradient included, into its one solid colour; no fill stays none. */
    private fun cast(fill: Fill?, silhouette: Colour?): Fill? =
        if (fill != null && silhouette != null) Fill.Solid(silhouette) else fill

    /** A silhouette colours a stroke that is there, keeping its width, dash, cap and join; it adds none. */
    private fun Colour?.over(stroke: Colour?): Colour? = if (stroke != null) this ?: stroke else null

    private fun drawText(canvas: Canvas, book: Book, item: Item.Text, inherited: Float) {
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
        applyFill(paint, book, item.fill, item.op, inherited, null)
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

    private fun drawImage(canvas: Canvas, item: Item.Image, inherited: Float) {
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
            val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG).apply { alpha = alphaOf(item.op, inherited) }
            drawBitmap(bitmap, src, dst, paint)
        }
    }

    private fun fillPaint(book: Book, fill: Fill?, op: Float?, inherited: Float, bounds: RectF, circle: Item.Circle? = null): Paint? {
        fill ?: return null
        return Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            applyFill(this, book, fill, op, inherited, circle)
        }
    }

    private fun applyFill(paint: Paint, book: Book, fill: Fill, op: Float?, inherited: Float, circle: Item.Circle?) {
        when (fill) {
            is Fill.Solid -> {
                paint.color = fill.colour.argb
                paint.alpha = alphaOf(op, inherited)
            }
            is Fill.Ref -> {
                val gradient = book.defs[fill.id] ?: error("unknown gradient ${fill.id}")
                paint.shader = shaderFor(gradient, circle)
                paint.alpha = alphaOf(op, inherited)
            }
        }
    }

    private fun shaderFor(g: Gradient, circle: Item.Circle?): Shader {
        val colours = IntArray(g.stops.size) { i ->
            val s = g.stops[i]
            (((s.opacity.coerceIn(0f, 1f) * 255).roundToInt()) shl 24) or (s.colour.argb and 0xFFFFFF)
        }
        val positions = FloatArray(g.stops.size) { g.stops[it].offset }
        return when {
            g.type == "linear" -> LinearGradient(g.x1, g.y1, g.x2, g.y2, colours, positions, Shader.TileMode.CLAMP)
            g.units == "item" && circle != null -> RadialGradient(
                circle.cx + g.cx * circle.r, circle.cy + g.cy * circle.r, (g.r * circle.r).coerceAtLeast(0.01f),
                colours, positions, Shader.TileMode.CLAMP,
            )
            else -> RadialGradient(g.cx, g.cy, g.r.coerceAtLeast(0.01f), colours, positions, Shader.TileMode.CLAMP)
        }
    }

    private fun strokePaint(stroke: Colour?, sw: Float?, dash: List<Float>?, cap: String?, join: String?, op: Float?, inherited: Float): Paint? {
        stroke ?: return null
        return Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            color = stroke.argb
            alpha = alphaOf(op, inherited)
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

    private fun alphaOf(op: Float?, inherited: Float): Int = ((op ?: 1f) * inherited * 255f).roundToInt().coerceIn(0, 255)
}
