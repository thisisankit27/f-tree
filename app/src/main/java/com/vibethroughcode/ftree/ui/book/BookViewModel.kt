package com.vibethroughcode.ftree.ui.book

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.Picture
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vibethroughcode.ftree.book.Book
import com.vibethroughcode.ftree.book.BookComposer
import com.vibethroughcode.ftree.book.BookFailure
import com.vibethroughcode.ftree.book.BookPrinter
import com.vibethroughcode.ftree.book.BookTemplates
import com.vibethroughcode.ftree.data.FamilyRepository
import com.vibethroughcode.ftree.data.KinshipLanguage
import com.vibethroughcode.ftree.data.KinshipPreferences
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.entitlement.AccessRequest
import com.vibethroughcode.ftree.entitlement.Decision
import com.vibethroughcode.ftree.entitlement.EntitlementContext
import com.vibethroughcode.ftree.entitlement.EntitlementSource
import com.vibethroughcode.ftree.entitlement.Entitlements
import com.vibethroughcode.ftree.entitlement.Policy
import com.vibethroughcode.ftree.entitlement.UsageLedger
import com.vibethroughcode.ftree.transfer.TreeExporter
import com.vibethroughcode.ftree.ui.common.matchingPeople
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import java.time.LocalDate

/** What the reader has chosen on the book screen. */
data class BookOptions(
    /** Set from the catalogue when the screen opens: the template in season, or the first listed. */
    val templateId: String = "",
    /** Null means "the title the book derives" - the family's own surname. */
    val title: String? = null,
    val branch: Boolean = false,
    val photos: Boolean = true,
    val livingDates: Boolean = false,
    /**
     * Who the story is told around. Null lets the composer choose (`resolveFeatured`,
     * `site/book/story/featured.js`) - a book nobody has set this on still tells somebody's story,
     * it just isn't the reader's own pick yet.
     */
    val featured: String? = null,
    /**
     * Off by default: a note is the family's own words, and a book like this is forwarded to
     * people nobody chose (docs/storybook-plan.md).
     */
    val notes: Boolean = false,
    /**
     * The reader's Family-words setting (`KinshipPreferences`), `"en"` or `"hi"` - not a control on
     * this screen, just carried through to the composer so a kin caption reads the way the rest of
     * the app already speaks (docs/family-book.md's "Kin captions").
     */
    val words: String = "en",
)

/** [KinshipLanguage] as the composer spells it (`site/book/compose.js`: anything but `"hi"` is English). */
internal fun wordsFor(language: KinshipLanguage): String = if (language == KinshipLanguage.HINDI) "hi" else "en"

/**
 * The `options` object [BookViewModel] sends the composer for [opts], as of [today] - pure and
 * independent of anything the screen has loaded (no document, no template, no WebView), so it is
 * exactly what `BookOptionsTest` exercises directly. [scopePersonId] is the person the book screen
 * was opened for, if it was; `opts.branch` only narrows the scope when there is one to narrow it to.
 * [coverOnly] mirrors `composeBook`'s own option (`site/book/compose.js`): the composer stops after
 * the first page, which `template.js` guarantees is always the cover.
 */
internal fun composerOptionsJson(
    opts: BookOptions,
    today: LocalDate,
    scopePersonId: String?,
    coverOnly: Boolean = false,
): JsonObject = buildJsonObject {
    put("now", today.toString())
    put("photos", opts.photos)
    put("livingDates", opts.livingDates)
    put("notes", opts.notes)
    put("words", opts.words)
    opts.featured?.let { put("featured", it) }
    if (coverOnly) put("coverOnly", true)
    opts.title?.trim()?.takeIf { it.isNotEmpty() }?.let { put("title", it) }
    if (opts.branch && scopePersonId != null) {
        putJsonObject("scope") {
            put("kind", "branch")
            put("personId", scopePersonId)
        }
    } else {
        putJsonObject("scope") { put("kind", "everyone") }
    }
}

data class TemplateChoice(
    val id: String,
    val name: String,
    val featured: Boolean,
    val cover: Picture?,
    /**
     * Whether this template tells one person's story. Heirloom draws the whole family as one
     * constellation with nobody at its centre, so "Whose story" has nothing to do there yet
     * (docs/storybook-plan.md: "the featured person is a generic option on every template, and
     * only Diwali uses it for now"). Every other template answers `true` until a second template
     * makes this worth declaring in `template.js` instead of naming it here by id.
     */
    val featuresOnePerson: Boolean = true,
)

data class BookUiState(
    val loading: Boolean = true,
    /** Nobody in the tree: there is nothing to make a book of. */
    val empty: Boolean = false,
    val options: BookOptions = BookOptions(),
    val templates: List<TemplateChoice> = emptyList(),
    /** Whose branch the screen was opened for, if it was. */
    val branchOf: String? = null,
    /** Whether anybody in the tree has a photograph, so the switch can say so when nobody does. */
    val hasPhotos: Boolean = false,
    /**
     * Who `resolveFeatured` would pick were [BookOptions.featured] left unset, for the "Chosen for
     * you: {name}" hint. Null while that is still being asked for, or once nobody in scope can be
     * featured - the row falls back to its own wording either way (`BookScreen.kt`).
     */
    val suggestedFeatured: Person? = null,
    /** [BookOptions.featured], resolved to a [Person] for the row to show. Null until picked. */
    val featuredPerson: Person? = null,
    val book: Book? = null,
    val pages: List<Picture> = emptyList(),
    val estimateBytes: Long = 0,
    val composing: Boolean = false,
    val busy: BookAction? = null,
    val failure: BookFailure? = null,
    val decision: Decision = Decision.Allowed,
    /** A one-off message: "Saved ...". Cleared once shown. */
    val notice: BookNotice? = null,
)

enum class BookAction { SHARING, SAVING }

sealed interface BookNotice {
    data class Saved(val fileName: String) : BookNotice
    data class Failed(val failure: BookFailure) : BookNotice
}

/**
 * The family book screen: composes the book as the reader changes it, and writes it when they
 * share or save it.
 *
 * The book is laid out by [BookComposer], the same composer the desktop runs, so this holds only
 * choices and results. Every export path asks the policy switch first ([Entitlements.decide]);
 * today it always answers "everything", and the day it doesn't, that is a change to the policy,
 * not to this screen. Only a book that was actually shared or saved is counted.
 */
@OptIn(FlowPreview::class)
class BookViewModel(
    private val exporter: TreeExporter,
    private val repository: FamilyRepository,
    private val printer: BookPrinter,
    private val composer: BookComposer,
    private val templates: BookTemplates,
    private val policy: Policy?,
    private val entitlements: EntitlementSource,
    private val ledger: UsageLedger,
    private val contentResolver: ContentResolver,
    private val kinship: KinshipPreferences,
    private val scopePersonId: String?,
    private val today: () -> LocalDate = LocalDate::now,
) : ViewModel() {

    private val _state = MutableStateFlow(
        BookUiState(options = BookOptions(branch = scopePersonId != null, words = wordsFor(kinship.language.value)))
    )
    val state: StateFlow<BookUiState> = _state.asStateFlow()

    private val options = MutableStateFlow(_state.value.options)
    private var document: JsonElement? = null
    private var templateJson: Map<String, JsonObject> = emptyMap()
    private var tierOf: Map<String, String> = emptyMap()
    private var photoOf: Map<String, String?> = emptyMap()
    private val photoCache = mutableMapOf<Pair<String, Int>, Bitmap>()
    private var photos: Map<String, Bitmap> = emptyMap()

    /** The people the screen fetched when it opened - what "Whose story" offers, and looks names up in. */
    private var people: List<Person> = emptyList()
    private var peopleById: Map<String, Person> = emptyMap()

    /** `scopePersonId`'s branch, computed once: what "Whose story" offers when `options.branch` is on. */
    private var branchIds: Set<String>? = null

    /** The last (branch, template) a "Chosen for you" suggestion was asked for, so a title edit or a
     * photos toggle doesn't cost a second WebView round trip for a value that couldn't have changed. */
    private var suggestionKey: Pair<Boolean, String>? = null

    init {
        // Independent of the people/document load below: a reader with the screen open on a
        // tablet's second pane while they change Settings › Family words in the first should not
        // have to close and reopen the book to see it (unlike everything else here, which is a
        // one-time snapshot of the tree as it stood when the screen opened).
        viewModelScope.launch {
            kinship.language.collect { language -> change { it.copy(words = wordsFor(language)) } }
        }
        viewModelScope.launch {
            val people = repository.allPeople()
            if (people.isEmpty()) {
                _state.update { it.copy(loading = false, empty = true) }
                return@launch
            }
            this@BookViewModel.people = people
            peopleById = people.associateBy { it.id }
            if (scopePersonId != null) branchIds = repository.branchIdsOf(scopePersonId)
            photoOf = people.associate { it.id to it.photoId }
            val branchOf = scopePersonId?.let { id -> people.firstOrNull { it.id == id }?.name?.trim()?.split(Regex("\\s+"))?.firstOrNull() }
            document = Json.parseToJsonElement(exporter.documentJson())
            val list = templates.offered(today())
            templateJson = list.associate { it.id to it.json }
            tierOf = list.associate { it.id to it.tier }
            _state.update {
                it.copy(
                    branchOf = branchOf,
                    hasPhotos = people.any { p -> p.photoId != null },
                    templates = list.map { t -> TemplateChoice(t.id, t.name, t.featured, null, featuresOnePerson = t.id !in TEMPLATES_WITHOUT_FEATURED) },
                )
            }
            list.firstOrNull()?.let { first -> change { it.copy(templateId = first.id) } }

            // The book first, the template choices' small covers after it: the reader is looking at
            // the book, and the composer takes one request at a time.
            launch { options.debounce(180).distinctUntilChanged().collect { compose(it) } }
            launch { drawCovers() }
        }
    }

    fun setTemplate(id: String) = change { it.copy(templateId = id) }
    fun setTitle(title: String) = change { it.copy(title = title) }
    fun resetTitle() = change { it.copy(title = null) }
    /**
     * Narrowing the scope can put the chosen "Whose story" person outside it - picked while
     * everyone was in scope, say, and the reader then switches to a branch that does not include
     * them. The composer would fall back silently (`resolveFeatured` only trusts an id still in
     * `family.byId`), which would draw the book around somebody the row no longer names, so this
     * resets the choice back to the composer's own pick rather than let the two disagree.
     */
    fun setBranch(branch: Boolean) {
        change { it.copy(branch = branch) }
        val featured = options.value.featured
        if (featured != null && featured !in scopedIds(branch)) setFeatured(null)
    }

    fun setPhotos(on: Boolean) = change { it.copy(photos = on) }
    fun setLivingDates(on: Boolean) = change { it.copy(livingDates = on) }
    fun setFeatured(personId: String?) {
        change { it.copy(featured = personId) }
        _state.update { it.copy(featuredPerson = personId?.let(peopleById::get)) }
    }
    fun resetFeatured() = setFeatured(null)
    fun setNotes(on: Boolean) = change { it.copy(notes = on) }
    fun noticeShown() = _state.update { it.copy(notice = null) }
    fun retry() = viewModelScope.launch { compose(options.value) }

    private fun scopedIds(branch: Boolean): Set<String> =
        if (branch) branchIds.orEmpty() else people.mapTo(mutableSetOf()) { it.id }

    /**
     * Who "Whose story" may offer: everyone in the book's current scope, ordered and narrowed to
     * [query] the same way the relation picker orders and narrows its own list ([matchingPeople]).
     * Read from the snapshot fetched when the screen opened - the same people the composed book
     * itself is drawn from - so typing in the picker never touches the database.
     */
    fun candidatesFor(query: String): List<Person> {
        val scoped = if (options.value.branch) people.filter { it.id in branchIds.orEmpty() } else people
        return matchingPeople(scoped, query)
    }

    private fun change(transform: (BookOptions) -> BookOptions) {
        val next = transform(options.value)
        options.value = next
        _state.update { it.copy(options = next) }
    }

    private fun decide(opts: BookOptions): Decision = Entitlements.decide(
        policy,
        AccessRequest(feature = FEATURE, templateId = opts.templateId, templateTier = tierOf[opts.templateId] ?: "free", people = photoOf.size),
        EntitlementContext(plan = entitlements.plan, usage = mapOf(FEATURE to ledger.count(FEATURE))),
    )

    private fun input(opts: BookOptions, allowance: JsonObject, coverOnly: Boolean = false): String? {
        val doc = document ?: return null
        val template = templateJson[opts.templateId] ?: templateJson.values.firstOrNull() ?: return null
        return buildJsonObject {
            put("doc", doc)
            put("options", composerOptionsJson(opts, today(), scopePersonId, coverOnly))
            put("template", template)
            put("allowance", allowance)
        }.toString()
    }

    private suspend fun compose(opts: BookOptions) {
        val decision = decide(opts)
        val allowance = buildJsonObject {
            (decision as? Decision.Limited)?.allowance?.maxGenerations?.let { put("maxGenerations", it) }
        }
        val json = input(opts, allowance) ?: return
        _state.update { it.copy(composing = true, failure = null, decision = decision) }
        try {
            val book = composer.compose(json)
            photos = photosFor(book)
            val pages = withContext(Dispatchers.Default) { printer.pictures(book, photos) }
            _state.update {
                it.copy(loading = false, composing = false, book = book, pages = pages, estimateBytes = estimate(book))
            }
            updateSuggestedFeatured(opts, json)
        } catch (failure: BookFailure) {
            // Written to the device's own log, which never leaves it: the one trace of a failed
            // layout that "Report a problem" can ask a reader to copy.
            android.util.Log.w("FTreeBook", "could not compose the book", failure)
            _state.update { it.copy(loading = false, composing = false, failure = failure) }
        }
    }

    /**
     * Keeps "Chosen for you" in step with `resolveFeatured` (`site/book/story/featured.js`) without
     * asking the WebView again for a value that couldn't have moved: it depends only on the family
     * in scope and `options.featured`, never on the title, the photos switch or living dates. Once
     * the reader picks somebody themselves there is nothing to suggest, and the next time they
     * reset it, the row asks again rather than showing whatever it last knew.
     */
    private suspend fun updateSuggestedFeatured(opts: BookOptions, json: String) {
        if (opts.featured != null) {
            suggestionKey = null
            return
        }
        val key = opts.branch to opts.templateId
        if (key == suggestionKey) return
        suggestionKey = key
        val suggested = composer.resolveFeatured(json)?.let(peopleById::get)
        _state.update { it.copy(suggestedFeatured = suggested) }
    }

    /** Portraits are decoded once per size and kept while the screen is open. */
    private suspend fun photosFor(book: Book): Map<String, Bitmap> {
        val wanted = book.photos.associate { it.id to it.px }
        val missing = book.copy(photos = book.photos.filter { (it.id to it.px) !in photoCache })
        printer.loadPhotos(missing) { photoOf[it] }.forEach { (id, bitmap) -> photoCache[id to wanted.getValue(id)] = bitmap }
        return wanted.mapNotNull { (id, px) -> photoCache[id to px]?.let { id to it } }.toMap()
    }

    /**
     * Each template's cover, drawn with this family, for the template choices.
     *
     * `coverOnly` (#244) stops the composer after the cover block instead of laying out the whole
     * book just to throw all but the first page away - the desktop pays this same cost per
     * template on every debounced keystroke, and the storybook's page count makes the old way of
     * doing this expensive enough to be worth the option existing at all.
     */
    private suspend fun drawCovers() {
        val opts = options.value
        val covers = templateJson.keys.associateWith { id ->
            val json = input(opts.copy(templateId = id, photos = false), buildJsonObject {}, coverOnly = true) ?: return@associateWith null
            runCatching { composer.compose(json) }.getOrNull()?.let { book ->
                withContext(Dispatchers.Default) { printer.pictures(book, emptyMap()).firstOrNull() }
            }
        }
        _state.update { s -> s.copy(templates = s.templates.map { it.copy(cover = covers[it.id]) }) }
    }

    /**
     * Writes the book for the share sheet and returns where it is. Counted as used only here, once
     * the file exists - a book the reader backed out of is not one they made.
     */
    suspend fun prepareShare(): Uri? = act(BookAction.SHARING) { book ->
        printer.writeForSharing(book, photos).also { ledger.record(FEATURE) }
    }

    /** Writes the book to wherever the reader chose in the system's save dialog. */
    fun saveTo(uri: Uri) {
        viewModelScope.launch {
            act(BookAction.SAVING) { book ->
                withContext(Dispatchers.IO) {
                    contentResolver.openOutputStream(uri, "w")?.use { printer.writePdf(book, photos, it) }
                        ?: throw BookFailure.Script("the chosen place could not be written to")
                }
                ledger.record(FEATURE)
                _state.update { it.copy(notice = BookNotice.Saved(book.fileName)) }
            }
        }
    }

    private suspend fun <T> act(action: BookAction, work: suspend (Book) -> T): T? {
        val book = state.value.book ?: return null
        if (state.value.decision is Decision.Locked) return null
        _state.update { it.copy(busy = action) }
        return try {
            work(book)
        } catch (failure: BookFailure) {
            _state.update { it.copy(notice = BookNotice.Failed(failure)) }
            null
        } catch (e: java.io.IOException) {
            _state.update { it.copy(notice = BookNotice.Failed(BookFailure.Script(e.message ?: "the file could not be written"))) }
            null
        } finally {
            _state.update { it.copy(busy = null) }
        }
    }

    override fun onCleared() {
        composer.close()
        photoCache.clear()
    }

    companion object {
        const val FEATURE = "book.export"

        /** Template ids that do not tell one person's story yet - see [TemplateChoice.featuresOnePerson]. */
        val TEMPLATES_WITHOUT_FEATURED = setOf("heirloom")

        /**
         * About how large the PDF will be. Android's PdfDocument keeps photographs losslessly, so
         * this is `site/book/compose.js`'s estimateBytes with `lossless: true`, kept in step with it.
         */
        fun estimate(book: Book): Long =
            420_000L + book.pages.size * 18_000L + book.photos.sumOf { (it.px.toLong() * it.px * 18) / 10 }
    }
}
