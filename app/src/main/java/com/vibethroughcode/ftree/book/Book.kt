package com.vibethroughcode.ftree.book

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.float
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * The family book as the composer hands it over: a display list, every coordinate decided.
 *
 * `site/book/format.js` is the source of truth and `docs/family-book.md` the contract; this is that
 * format read in Kotlin, and read strictly - an unknown key, an unknown item type or a format this
 * app does not know is a [SerializationException], never something drawn approximately. The book
 * is laid out once, in JavaScript, for both shells; the one way Android could quietly disagree
 * with the desktop is by reading it loosely.
 */
@Serializable
data class Book(
    val format: Int,
    val template: String,
    val title: String,
    val fileName: String,
    val size: PageSize,
    val fonts: Map<String, String>,
    val defs: Map<String, Gradient> = emptyMap(),
    val photos: List<PhotoRequest> = emptyList(),
    val pages: List<Page>,
    /**
     * Format 2's art, authored once and drawn many times by [Item.Use]. Absent in the JSON when a
     * book has none - never `{}`, which [readBook] refuses (docs/family-book.md, "Never write empty
     * symbols").
     */
    val symbols: Map<String, Symbol> = emptyMap(),
) {
    companion object {
        /** The vocabulary every painter has always had. `site/book/format.js`'s FORMAT. */
        const val FORMAT = 1

        /** The newest format this painter draws. `site/book/format.js`'s FORMAT_MAX. */
        const val FORMAT_MAX = 2

        /**
         * How many symbols deep one `use` on a page may reach, and the most items one page may draw
         * once every `use` is expanded. `format.js` exports both and `svg.js` reads the same ones;
         * `BookFormatTest` reads them from `format.js` as text so the three cannot drift.
         */
        const val MAX_SYMBOL_DEPTH = 4
        const val MAX_EXPANDED_ITEMS = 20000
    }
}

/** Art drawn by [Item.Use]: shapes only - rect, circle, path, group and use, never text or a photograph. */
@Serializable
data class Symbol(val items: List<Item>)

@Serializable
data class PageSize(val w: Int, val h: Int)

@Serializable
data class PhotoRequest(val id: String, val px: Int)

@Serializable
data class Page(val label: String, val items: List<Item>)

/** One drawing instruction. `t` in the JSON names which. */
@Serializable
sealed interface Item {
    @Serializable
    @SerialName("rect")
    data class Rect(
        val x: Float, val y: Float, val w: Float, val h: Float,
        val r: Float? = null,
        val fill: Fill? = null,
        val stroke: Colour? = null, val sw: Float? = null, val dash: List<Float>? = null,
        val op: Float? = null,
    ) : Item

    @Serializable
    @SerialName("circle")
    data class Circle(
        val cx: Float, val cy: Float, val r: Float,
        val fill: Fill? = null,
        val stroke: Colour? = null, val sw: Float? = null, val dash: List<Float>? = null,
        val op: Float? = null,
    ) : Item

    @Serializable
    @SerialName("path")
    data class Path(
        val d: String,
        val fill: Fill? = null,
        val stroke: Colour? = null, val sw: Float? = null, val dash: List<Float>? = null,
        val cap: String? = null, val join: String? = null,
        val rule: String? = null,
        val op: Float? = null,
    ) : Item

    @Serializable
    @SerialName("text")
    data class Text(
        val x: Float, val y: Float,
        val s: String,
        val font: String,
        val size: Float,
        val fill: Fill,
        val align: String? = null,
        /** The width the composer measured this line at; a painter may shrink it to fit, never grow it. */
        val w: Float? = null,
        val op: Float? = null,
    ) : Item

    @Serializable
    @SerialName("image")
    data class Image(
        val id: String,
        val x: Float, val y: Float, val w: Float, val h: Float,
        val clip: String,
        val op: Float? = null,
    ) : Item

    @Serializable
    @SerialName("group")
    data class Group(
        val items: List<Item>,
        /** Affine `[a b c d e f]`, SVG's `matrix()` order. */
        val tf: List<Float>? = null,
        /**
         * Format 2: path data, filled nonzero, in the group's own coordinates - inside [tf], so a
         * painter saves, concatenates [tf], clips, then draws.
         */
        val clip: String? = null,
        /** One layer: the group is drawn at full strength, then composited once at this alpha. */
        val op: Float? = null,
    ) : Item

    /**
     * Format 2: draws the symbol [ref] names in [Book.symbols], where it stands. [fill] is
     * silhouette mode - every fill and stroke the symbol draws takes this one colour, all the way
     * down, and nothing else about it changes. [op] is one layer, as a group's is.
     */
    @Serializable
    @SerialName("use")
    data class Use(
        val ref: String,
        val tf: List<Float>? = null,
        val fill: Colour? = null,
        val op: Float? = null,
    ) : Item
}

/** `#rrggbb` as an opaque ARGB int, parsed once when the book is read. */
@Serializable(with = ColourSerializer::class)
@JvmInline
value class Colour(val argb: Int)

/** A fill is a colour, or a reference to a gradient in [Book.defs]. */
@Serializable(with = FillSerializer::class)
sealed interface Fill {
    data class Solid(val colour: Colour) : Fill
    data class Ref(val id: String) : Fill
}

@Serializable
data class Gradient(
    val type: String,
    /** `null` for user space; `"item"` for a radial gradient measured in radii of the circle it fills. */
    val units: String? = null,
    val cx: Float = 0f, val cy: Float = 0f, val r: Float = 0f,
    val x1: Float = 0f, val y1: Float = 0f, val x2: Float = 0f, val y2: Float = 0f,
    val stops: List<Stop>,
)

/** `[offset, colour, opacity]` in the JSON. */
@Serializable(with = StopSerializer::class)
data class Stop(val offset: Float, val colour: Colour, val opacity: Float)

private val HEX = Regex("^#[0-9a-f]{6}$")

private fun parseColour(s: String): Colour {
    if (!HEX.matches(s)) throw SerializationException("not a #rrggbb colour: $s")
    return Colour((0xFF shl 24) or s.substring(1).toInt(16))
}

private fun formatColour(c: Colour) = "#%06x".format(c.argb and 0xFFFFFF)

object ColourSerializer : KSerializer<Colour> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("Colour", PrimitiveKind.STRING)
    override fun deserialize(decoder: Decoder) = parseColour(decoder.decodeString())
    override fun serialize(encoder: Encoder, value: Colour) = encoder.encodeString(formatColour(value))
}

object FillSerializer : KSerializer<Fill> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("Fill", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): Fill {
        val element = (decoder as? JsonDecoder)?.decodeJsonElement() ?: throw SerializationException("a fill is JSON")
        return when (element) {
            is JsonPrimitive -> Fill.Solid(parseColour(element.content))
            is JsonObject -> {
                if (element.keys != setOf("ref")) throw SerializationException("a gradient fill has only a ref: $element")
                Fill.Ref(element.getValue("ref").jsonPrimitive.content)
            }
            else -> throw SerializationException("not a fill: $element")
        }
    }

    override fun serialize(encoder: Encoder, value: Fill) {
        val json = encoder as? JsonEncoder ?: throw SerializationException("a fill is JSON")
        json.encodeJsonElement(
            when (value) {
                is Fill.Solid -> JsonPrimitive(formatColour(value.colour))
                is Fill.Ref -> JsonObject(mapOf("ref" to JsonPrimitive(value.id)))
            },
        )
    }
}

object StopSerializer : KSerializer<Stop> {
    override val descriptor: SerialDescriptor = PrimitiveSerialDescriptor("Stop", PrimitiveKind.STRING)

    override fun deserialize(decoder: Decoder): Stop {
        val element: JsonElement = (decoder as? JsonDecoder)?.decodeJsonElement() ?: throw SerializationException("a stop is JSON")
        val parts = element as? JsonArray ?: throw SerializationException("a stop is [offset, colour, opacity]")
        if (parts.size != 3) throw SerializationException("a stop is [offset, colour, opacity]: $element")
        return Stop(parts[0].jsonPrimitive.float, parseColour(parts[1].jsonPrimitive.content), parts[2].jsonPrimitive.float)
    }

    override fun serialize(encoder: Encoder, value: Stop) {
        val json = encoder as? JsonEncoder ?: throw SerializationException("a stop is JSON")
        json.encodeJsonElement(JsonArray(listOf(JsonPrimitive(value.offset), JsonPrimitive(formatColour(value.colour)), JsonPrimitive(value.opacity))))
    }
}

/**
 * Strict on purpose: no unknown keys, no coercion. `t` is the discriminator the composer writes.
 */
val BookJson = Json {
    ignoreUnknownKeys = false
    classDiscriminator = "t"
    explicitNulls = false
    encodeDefaults = false
}

/**
 * Reads a book, refusing one from a newer composer before looking at anything else in it, and then
 * holding it to everything [validateBook] checks - so a painter handed the result may assume every
 * ref resolves, every path parses and every font it names is one this app carries.
 *
 * @param fontKeys the font files this app embeds; a book naming any other is refused rather than
 *   drawn with a line of text missing.
 */
fun readBook(text: String, fontKeys: Set<String> = BookPrinter.FONT_FILES.keys): Book {
    val root = BookJson.parseToJsonElement(text) as? JsonObject ?: throw SerializationException("a book is a JSON object")
    val declared = root["format"]
    val format = (declared as? JsonPrimitive)?.takeIf { !it.isString }?.intOrNull
    if (format != Book.FORMAT && format != Book.FORMAT_MAX) {
        throw SerializationException(
            "book format $declared; this app draws formats ${Book.FORMAT} and ${Book.FORMAT_MAX}. " +
                "Update f-tree to make this book.",
        )
    }
    // Read before decoding: `null` and `{}` would otherwise both arrive as "no symbols", and a
    // book that declares symbols it does not carry is a composer bug, not an empty map.
    root["symbols"]?.let { symbols ->
        if (symbols !is JsonObject) throw SerializationException("book: symbols is not a map")
        if (symbols.isEmpty()) throw SerializationException("book: symbols is empty")
    }
    val book = BookJson.decodeFromJsonElement(Book.serializer(), root)
    val problems = validateBook(book, fontKeys)
    if (problems.isNotEmpty()) throw SerializationException("this app cannot draw the book: ${problems.joinToString("; ")}")
    return book
}
