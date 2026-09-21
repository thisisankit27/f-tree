package com.vibethroughcode.ftree.ui.book

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.graphics.Picture
import android.os.Build
import android.text.format.Formatter
import android.webkit.WebView
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.SaveAlt
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.graphics.withScale
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vibethroughcode.ftree.BuildConfig
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.book.BookFailure
import com.vibethroughcode.ftree.book.sendBookIntent
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.entitlement.Decision
import com.vibethroughcode.ftree.ui.FTreeViewModels
import com.vibethroughcode.ftree.ui.common.PersonAvatar
import com.vibethroughcode.ftree.ui.common.PersonPicker
import com.vibethroughcode.ftree.ui.common.SectionRule
import com.vibethroughcode.ftree.ui.common.displayName
import com.vibethroughcode.ftree.ui.theme.FTreeText
import kotlinx.coroutines.launch

const val BookScreenTag = "book-screen"
const val BookPreviewTag = "book-preview"
const val BookShareTag = "book-share"
const val BookCopyDetailsTag = "book-copy-details"
const val BookSaveTag = "book-save"
const val BookTitleFieldTag = "book-title"
const val BookPhotosTag = "book-photos"
const val BookLivingDatesTag = "book-living-dates"
const val BookPageLabelTag = "book-page-label"
const val BookFeaturedRowTag = "book-featured-row"
const val BookFeaturedResetTag = "book-featured-reset"
const val BookFeaturedSearchTag = "book-featured-search"
const val BookFeaturedListTag = "book-featured-list"
const val BookNotesTag = "book-notes"

/** A4's proportions, which every preview page is drawn at. */
private const val PAGE_ASPECT = 595f / 842f

/**
 * The family book: the preview is the book itself, and the options under it change it.
 *
 * docs/family-book.md describes this screen once for both shells; the desktop's dialog is the same
 * screen laid out for a wide window. On a phone it reads top to bottom, preview first; on a wide or
 * landscape window the preview takes the left and the options the right. Share and Save sit in the
 * bottom bar, reachable by a thumb whatever the reader has scrolled to.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BookScreen(
    onBack: () -> Unit,
    viewModel: BookViewModel = viewModel(factory = FTreeViewModels.Factory),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val snackbar = remember { SnackbarHostState() }

    val saveLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/pdf")) { uri ->
        if (uri != null) viewModel.saveTo(uri)
    }

    val savedMessage = stringResource(R.string.book_saved)
    val failedMessage = stringResource(R.string.book_action_failed)
    LaunchedEffect(state.notice) {
        when (val notice = state.notice) {
            is BookNotice.Saved -> snackbar.showSnackbar(savedMessage.format(notice.fileName))
            is BookNotice.Failed -> snackbar.showSnackbar(failedMessage.format(notice.failure.message.orEmpty()))
            null -> Unit
        }
        if (state.notice != null) viewModel.noticeShown()
    }

    val shareTitle = stringResource(R.string.book_share_chooser)
    val caption = stringResource(R.string.book_share_caption)
    val canAct = state.book != null && state.busy == null && state.decision !is Decision.Locked

    Scaffold(
        modifier = Modifier.testTag(BookScreenTag),
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.book_screen_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.book_back))
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            if (!state.empty) {
                Surface(tonalElevation = 3.dp) {
                    Row(
                        modifier = Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.End),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        OutlinedButton(
                            onClick = { state.book?.let { saveLauncher.launch(it.fileName) } },
                            enabled = canAct,
                            modifier = Modifier.testTag(BookSaveTag),
                        ) {
                            Icon(Icons.Default.SaveAlt, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(stringResource(R.string.book_save))
                        }
                        FilledTonalButton(
                            onClick = {
                                scope.launch {
                                    val book = state.book ?: return@launch
                                    val uri = viewModel.prepareShare() ?: return@launch
                                    val send = sendBookIntent(uri, book.title, caption.format(book.title))
                                    context.startActivity(Intent.createChooser(send, shareTitle))
                                }
                            },
                            enabled = canAct,
                            modifier = Modifier.testTag(BookShareTag),
                        ) {
                            Icon(Icons.Default.Share, contentDescription = null, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(8.dp))
                            Text(stringResource(R.string.book_share))
                        }
                    }
                }
            }
        },
    ) { padding ->
        if (state.empty) {
            Box(Modifier.fillMaxSize().padding(padding).padding(32.dp), contentAlignment = Alignment.Center) {
                Text(
                    stringResource(R.string.book_empty),
                    style = MaterialTheme.typography.bodyLarge,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            return@Scaffold
        }
        BoxWithConstraints(Modifier.fillMaxSize().padding(padding)) {
            val wide = maxWidth >= 720.dp
            // A phone's preview is as tall as a page at the screen's width, but never more than
            // most of the screen, so the options below it are always in sight.
            val previewHeight = minOf(maxHeight * 0.62f, (maxWidth - 64.dp) / PAGE_ASPECT + 36.dp)
            Column(Modifier.fillMaxSize()) {
                Progress(state)
                if (wide) {
                    Row(Modifier.fillMaxSize()) {
                        Preview(state, viewModel::retry, Modifier.weight(1f).fillMaxHeight().padding(24.dp))
                        Column(
                            Modifier.width(380.dp).fillMaxHeight().verticalScroll(rememberScrollState()).padding(end = 24.dp, bottom = 24.dp),
                        ) {
                            Options(state, viewModel)
                        }
                    }
                } else {
                    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                        Preview(
                            state,
                            viewModel::retry,
                            Modifier
                                .fillMaxWidth()
                                .padding(top = 16.dp)
                                .height(previewHeight),
                        )
                        Column(Modifier.padding(horizontal = 24.dp).widthIn(max = 560.dp).align(Alignment.CenterHorizontally)) {
                            Options(state, viewModel)
                            Spacer(Modifier.height(24.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Progress(state: BookUiState) {
    val working = state.composing || state.busy != null || state.loading
    val label = when (state.busy) {
        BookAction.SHARING, BookAction.SAVING -> stringResource(R.string.book_writing)
        null -> stringResource(R.string.book_making)
    }
    Box(Modifier.fillMaxWidth().height(4.dp)) {
        if (working) {
            LinearProgressIndicator(
                Modifier.fillMaxWidth().semantics {
                    contentDescription = label
                    liveRegion = LiveRegionMode.Polite
                },
            )
        }
    }
}

@Composable
private fun Preview(state: BookUiState, onRetry: () -> Unit, modifier: Modifier) {
    val failure = state.failure
    if (failure != null && state.pages.isEmpty()) {
        FailureCard(failure, onRetry, modifier)
        return
    }
    val pages = state.pages
    val labels = state.book?.pages?.map { it.label }.orEmpty()
    if (pages.isEmpty()) {
        Box(modifier, contentAlignment = Alignment.Center) {
            Text(stringResource(R.string.book_making), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }
    val pager = rememberPagerState { pages.size }
    Column(modifier.testTag(BookPreviewTag), horizontalAlignment = Alignment.CenterHorizontally) {
        BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
            // Each page is as wide as the height allows. On a phone that is the width less a margin;
            // on a tablet the room either side shows the neighbouring pages instead of standing empty.
            val side = (maxWidth - minOf(maxWidth - 64.dp, maxHeight * PAGE_ASPECT)) / 2
            HorizontalPager(
                state = pager,
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(horizontal = side),
                pageSpacing = 16.dp,
            ) { index ->
                val description = stringResource(R.string.book_page_description, index + 1, pages.size, labels.getOrElse(index) { "" })
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    PageSurface(pages[index], Modifier.semantics { contentDescription = description })
                }
            }
        }
        Text(
            stringResource(R.string.book_page_of, pager.currentPage + 1, pages.size),
            style = FTreeText.recordSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 10.dp).testTag(BookPageLabelTag),
        )
    }
}

/** One page, drawn from the very picture the PDF is painted from, at whatever size fits. */
@Composable
private fun PageSurface(picture: Picture, modifier: Modifier = Modifier) {
    Surface(
        modifier = modifier.aspectRatio(PAGE_ASPECT),
        shape = RoundedCornerShape(2.dp),
        shadowElevation = 3.dp,
    ) {
        Canvas(Modifier.fillMaxSize()) {
            drawIntoCanvas { canvas ->
                val native = canvas.nativeCanvas
                native.withScale(size.width / picture.width, size.height / picture.height, 0f, 0f) { drawPicture(picture) }
            }
        }
    }
}

@Composable
private fun FailureCard(failure: BookFailure, onRetry: () -> Unit, modifier: Modifier) {
    val message = when (failure) {
        BookFailure.NoWebView -> stringResource(R.string.book_failed_webview)
        is BookFailure.OldWebView -> stringResource(R.string.book_failed_old_webview, failure.version)
        BookFailure.Crashed, BookFailure.TimedOut -> stringResource(R.string.book_failed_retry)
        is BookFailure.Script -> stringResource(R.string.book_failed_script)
    }
    val context = LocalContext.current
    var copied by remember(failure) { mutableStateOf(false) }
    Column(modifier.padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            message,
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
        Spacer(Modifier.height(16.dp))
        when (failure) {
            BookFailure.Crashed, BookFailure.TimedOut -> OutlinedButton(onClick = onRetry) { Text(stringResource(R.string.book_try_again)) }
            is BookFailure.Script -> TextButton(
                onClick = {
                    // Onto this phone's clipboard and nowhere else: the reader decides whether to send it.
                    context.getSystemService(ClipboardManager::class.java)
                        ?.setPrimaryClip(ClipData.newPlainText("f-tree", failureDetails(failure)))
                    copied = true
                },
                modifier = Modifier.testTag(BookCopyDetailsTag),
            ) { Text(stringResource(if (copied) R.string.book_details_copied else R.string.book_copy_details)) }
            else -> Unit
        }
    }
}

/** What a report needs to find the fault: the versions involved and the composer's own error. */
private fun failureDetails(failure: BookFailure): String =
    "f-tree ${BuildConfig.VERSION_NAME}, Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT}), " +
        "WebView ${WebView.getCurrentWebViewPackage()?.versionName ?: "none"}\n${failure.message}"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Options(state: BookUiState, viewModel: BookViewModel) {
    val options = state.options

    when (val decision = state.decision) {
        is Decision.Locked -> Notice(stringResource(R.string.book_locked))
        is Decision.Limited -> Notice(stringResource(R.string.book_limited))
        Decision.Allowed -> Unit
    }

    SectionRule(stringResource(R.string.book_template))
    LazyRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        items(state.templates, key = { it.id }) { template ->
            val selected = template.id == options.templateId
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier
                    .width(96.dp)
                    .selectable(selected = selected, role = Role.RadioButton, onClick = { viewModel.setTemplate(template.id) })
                    .padding(vertical = 4.dp),
            ) {
                Surface(
                    shape = RoundedCornerShape(4.dp),
                    border = BorderStroke(if (selected) 2.dp else 1.dp, if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant),
                    modifier = Modifier.width(88.dp).aspectRatio(PAGE_ASPECT),
                ) {
                    template.cover?.let { cover ->
                        Canvas(Modifier.fillMaxSize()) {
                            drawIntoCanvas { canvas ->
                                val native = canvas.nativeCanvas
                                native.withScale(size.width / cover.width, size.height / cover.height, 0f, 0f) { drawPicture(cover) }
                            }
                        }
                    }
                }
                Text(
                    template.name,
                    style = MaterialTheme.typography.labelLarge,
                    color = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.padding(top = 6.dp),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                if (template.featured) {
                    Text(
                        stringResource(R.string.book_this_season),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.tertiary,
                        maxLines = 1,
                    )
                }
            }
        }
    }

    SectionRule(stringResource(R.string.book_title_label))
    OutlinedTextField(
        value = options.title ?: state.book?.title.orEmpty(),
        onValueChange = viewModel::setTitle,
        singleLine = true,
        modifier = Modifier.fillMaxWidth().testTag(BookTitleFieldTag),
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
        trailingIcon = if (options.title != null) ({
            TextButton(onClick = viewModel::resetTitle) { Text(stringResource(R.string.book_title_reset)) }
        }) else null,
    )

    state.branchOf?.let { name ->
        SectionRule(stringResource(R.string.book_who))
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            SegmentedButton(
                selected = !options.branch,
                onClick = { viewModel.setBranch(false) },
                shape = SegmentedButtonDefaults.itemShape(0, 2),
            ) { Text(stringResource(R.string.book_who_everyone), maxLines = 1) }
            SegmentedButton(
                selected = options.branch,
                onClick = { viewModel.setBranch(true) },
                shape = SegmentedButtonDefaults.itemShape(1, 2),
            ) { Text(stringResource(R.string.book_who_branch, name), maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
    }

    val featuresOnePerson = state.templates.firstOrNull { it.id == options.templateId }?.featuresOnePerson ?: true
    SectionRule(stringResource(R.string.book_featured_title))
    if (!featuresOnePerson) {
        Text(
            text = stringResource(R.string.book_featured_heirloom_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 8.dp),
        )
    }
    var pickingFeatured by remember { mutableStateOf(false) }
    var featuredQuery by remember { mutableStateOf("") }
    FeaturedRow(
        person = state.featuredPerson,
        suggested = state.suggestedFeatured,
        onOpen = { featuredQuery = ""; pickingFeatured = true },
        onReset = viewModel::resetFeatured,
    )
    if (pickingFeatured) {
        val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
        ModalBottomSheet(onDismissRequest = { pickingFeatured = false }, sheetState = sheetState) {
            PersonPicker(
                people = viewModel.candidatesFor(featuredQuery),
                query = featuredQuery,
                onQueryChange = { featuredQuery = it },
                onPick = { id ->
                    viewModel.setFeatured(id)
                    pickingFeatured = false
                },
                onCancel = { pickingFeatured = false },
                modifier = Modifier.fillMaxWidth().height(480.dp),
                searchTag = BookFeaturedSearchTag,
                listTag = BookFeaturedListTag,
            )
        }
    }

    SectionRule(stringResource(R.string.book_details))
    val context = LocalContext.current
    SwitchRow(
        label = stringResource(R.string.book_photos),
        detail = when {
            !state.hasPhotos -> stringResource(R.string.book_photos_none)
            options.photos && state.book != null -> stringResource(R.string.book_photos_estimate, Formatter.formatShortFileSize(context, state.estimateBytes))
            else -> null
        },
        checked = options.photos,
        onChange = viewModel::setPhotos,
        tag = BookPhotosTag,
    )
    SwitchRow(
        label = stringResource(R.string.book_living_dates),
        detail = stringResource(R.string.book_living_dates_help),
        checked = options.livingDates,
        onChange = viewModel::setLivingDates,
        tag = BookLivingDatesTag,
    )
    SwitchRow(
        label = stringResource(R.string.book_notes),
        detail = stringResource(R.string.book_notes_help),
        checked = options.notes,
        onChange = viewModel::setNotes,
        tag = BookNotesTag,
    )
}

/**
 * "Whose story": opens the shared [PersonPicker] to choose who the book is told around. Shows the
 * composer's own default ("Chosen for you: {name}") until the reader picks somebody, and a
 * separate Reset once they have - matching the title field's own reset pattern above.
 */
@Composable
private fun FeaturedRow(person: Person?, suggested: Person?, onOpen: () -> Unit, onReset: () -> Unit) {
    val label = when {
        person != null -> person.displayName()
        suggested != null -> stringResource(R.string.book_featured_suggested, suggested.displayName())
        else -> stringResource(R.string.book_featured_choose)
    }
    val hint = stringResource(R.string.book_featured_row_hint)
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Surface(
            onClick = onOpen,
            shape = RoundedCornerShape(8.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
            modifier = Modifier
                .weight(1f)
                .testTag(BookFeaturedRowTag)
                .semantics(mergeDescendants = true) {
                    contentDescription = "$label. $hint"
                    role = Role.Button
                },
        ) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(36.dp), contentAlignment = Alignment.Center) {
                    person?.let { PersonAvatar(it, diameter = 36.dp, decorative = true) }
                }
                Spacer(Modifier.width(12.dp))
                Text(
                    text = label,
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (person != null) {
            TextButton(onClick = onReset, modifier = Modifier.testTag(BookFeaturedResetTag)) {
                Text(stringResource(R.string.book_featured_reset))
            }
        }
    }
}

@Composable
private fun Notice(text: String) {
    Surface(color = MaterialTheme.colorScheme.secondaryContainer, shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) {
        Text(text, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(16.dp))
    }
}

@Composable
private fun SwitchRow(label: String, detail: String?, checked: Boolean, onChange: (Boolean) -> Unit, tag: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .toggleable(value = checked, role = Role.Switch, onValueChange = onChange)
            .padding(vertical = 10.dp)
            .testTag(tag),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f).padding(end = 16.dp)) {
            Text(label, style = MaterialTheme.typography.bodyLarge)
            detail?.let {
                Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        // The row is the control; the switch only shows its state, so it is not a second target.
        Switch(checked = checked, onCheckedChange = null)
    }
}
