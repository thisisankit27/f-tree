package com.vibethroughcode.ftree.ui.tree

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CenterFocusStrong
import androidx.compose.material.icons.filled.CompareArrows
import androidx.compose.material.icons.filled.FitScreen
import androidx.compose.material.icons.filled.PersonAddAlt
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.UnfoldMore
import androidx.compose.material3.AssistChip
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.activity.compose.BackHandler
import androidx.compose.material3.BottomSheetScaffold
import androidx.compose.material3.SheetValue
import androidx.compose.material3.rememberBottomSheetScaffoldState
import androidx.compose.material3.rememberStandardBottomSheetState
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.data.RelativeKind
import com.vibethroughcode.ftree.ui.FTreeViewModels
import com.vibethroughcode.ftree.ui.common.EmptyState
import com.vibethroughcode.ftree.ui.common.PersonRow
import com.vibethroughcode.ftree.ui.common.TreeGlyph
import com.vibethroughcode.ftree.ui.common.displayName
import com.vibethroughcode.ftree.ui.common.isShortWindow
import com.vibethroughcode.ftree.graph.Relation
import com.vibethroughcode.ftree.ui.relation.RelationSheet
import com.vibethroughcode.ftree.ui.relation.RelationSlot
import com.vibethroughcode.ftree.ui.relation.RelationViewModel
import com.vibethroughcode.ftree.ui.relation.ShareCard
import com.vibethroughcode.ftree.ui.common.relativeKindLabel
import com.vibethroughcode.ftree.ui.theme.FTreeText

const val TreeAddButtonTag = "tree-add"
const val TreeFocusHereTag = "tree-focus-here"
const val TreeOpenPersonTag = "tree-open-person"
const val TreeModeCompactTag = "tree-mode-compact"
const val TreeModeFocusedTag = "tree-mode-focused"
const val TreeModeWholeTag = "tree-mode-whole"
const val TreeRelateTag = "tree-relate"
const val TreeRelateFromTag = "tree-relate-from"
const val TreeShareTag = "tree-share"
const val TreeFrameTag = "tree-frame"

/**
 * Which view of the tree is on screen.
 *
 * Three answers to three different questions, not three settings.
 *
 * [FOCUSED] answers "who is around this person", which is what you want while adding relatives.
 * [WHOLE] answers "what is in this record" — a question the focused chart structurally cannot
 * answer, because the people in the answer are exactly the ones it never draws. [COMPACT] answers
 * the same question as [FOCUSED] and differs only in *form*: it is composed rather than painted, so
 * it can be read at any text size, tapped with a thumb and spoken by a screen reader, none of which
 * a canvas can do.
 *
 * They are ordered by how much they ask of the reader — a page, a picture, the whole archive — and
 * the middle one is where the screen opens, because "the family around me" is the question people
 * arrive with.
 */
/** The drag handle Material draws above the sheet's own content. */
private val SHEET_HANDLE = 48.dp

private enum class ChartMode { COMPACT, FOCUSED, WHOLE }

private val ChartMode.label: Int
    get() = when (this) {
        ChartMode.COMPACT -> R.string.tree_mode_compact
        ChartMode.FOCUSED -> R.string.tree_mode_focused
        ChartMode.WHOLE -> R.string.tree_mode_whole
    }

private val ChartMode.tag: String
    get() = when (this) {
        ChartMode.COMPACT -> TreeModeCompactTag
        ChartMode.FOCUSED -> TreeModeFocusedTag
        ChartMode.WHOLE -> TreeModeWholeTag
    }

/** True for the two views centred on one person, which share a focus and a loaded neighbourhood. */
private val ChartMode.isAroundOnePerson: Boolean get() = this != ChartMode.WHOLE

/** True for the two painted on a canvas, which are the two that can be panned away from. */
private val ChartMode.isDrawn: Boolean get() = this != ChartMode.COMPACT

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TreeScreen(
    onOpenPerson: (String) -> Unit,
    onAddPerson: () -> Unit,
    onAddRelative: (String, RelativeKind) -> Unit,
    onShare: (String) -> Unit,
    modifier: Modifier = Modifier,
    /** Somebody the reader has already named for a relation, arriving from their page. */
    relateFrom: String? = null,
    viewModel: TreeViewModel = viewModel(factory = FTreeViewModels.Factory),
    wholeTreeViewModel: WholeTreeViewModel = viewModel(factory = FTreeViewModels.Factory),
    relationViewModel: RelationViewModel = viewModel(factory = FTreeViewModels.Factory),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val photosInChart by viewModel.photosInChart.collectAsStateWithLifecycle()
    val photos = rememberChartPhotos(photosInChart)
    val wholeState by wholeTreeViewModel.uiState.collectAsStateWithLifecycle()
    val highlighted by wholeTreeViewModel.highlighted.collectAsStateWithLifecycle()
    val wholeSelection by wholeTreeViewModel.selected.collectAsStateWithLifecycle()

    var mode by rememberSaveable { mutableStateOf(ChartMode.FOCUSED) }
    var selected by remember { mutableStateOf<Person?>(null) }
    /*
     * Bumped to put a chart back on its family.
     *
     * Panning is now clamped so the chart can never be lost entirely, but a reader who has zoomed
     * into one corner of a large record still has a long way back. Re-framing is one tap, and it is
     * the same framing the chart opens with rather than a second idea of where "home" is.
     */
    var frameSignal by remember { mutableIntStateOf(0) }
    val personSheetState = rememberModalBottomSheetState()

    /*
     * The relation, asked and answered on this screen.
     *
     * `relating` is whether the sheet is up rather than whether an answer exists: the reader opens
     * it to ask, and the two ends arrive one at a time. The chart draws the line as soon as there
     * is one, so the picture assembles itself while the question is still being put together.
     */
    val relation by relationViewModel.uiState.collectAsStateWithLifecycle()
    val relationQuery by relationViewModel.currentQuery.collectAsStateWithLifecycle()
    var relating by rememberSaveable { mutableStateOf(relateFrom != null) }
    var picking by rememberSaveable { mutableStateOf<RelationSlot?>(null) }
    var sharingRelation by rememberSaveable { mutableStateOf(false) }
    /*
     * How much of the sheet stands above the fold, measured from the sentence rather than set to a
     * number — so a long answer, a Hindi term with its gloss, and somebody's larger type all still
     * show whole. Until it has been measured the sheet is closed and the value is not used.
     */
    var answerHeight by remember { mutableStateOf(0.dp) }
    var askHeight by remember { mutableStateOf(0.dp) }

    val fold = if (relation.relation == null) askHeight else answerHeight
    val trace = if (relating) relation.trace else emptyList()
    val tracing = remember(trace) { trace.toSet() }

    // The chart draws the traced line on its own rather than lighting it inside the whole record,
    // so the view model has to know before it lays anything out.
    LaunchedEffect(trace) { wholeTreeViewModel.onTraceChanged(trace) }
    LaunchedEffect(tracing) {
        // A traced line is only meaningful on the whole-tree chart: the focused one draws three
        // generations around one person, and the far end of a line is usually not among them.
        if (tracing.isNotEmpty()) {
            mode = ChartMode.WHOLE
            wholeTreeViewModel.select(null)
        }
    }
    /*
     * Put the chart back on its family whenever the room it has changes.
     *
     * The sheet takes the bottom of the screen and gives it back, and a chart framed for the taller
     * viewport is left sitting against one edge of the shorter one. Re-framing is the same framing
     * the chart opens with, so the line lands where a reader would expect to find it.
     */
    LaunchedEffect(fold, relating) { frameSignal++ }

    /*
     * Opening the sheet is what makes it a question; closing it is what ends one.
     *
     * Closing also clears the pair, because the alternative — coming back to the chart tomorrow
     * and finding a line still lit from a question asked today — is the thing the old route
     * argument existed to prevent.
     */
    val openRelation: (String?) -> Unit = { personId ->
        personId?.let(relationViewModel::name)
        relating = true
    }
    val closeRelation: () -> Unit = {
        relating = false
        picking = null
        relationViewModel.clear()
    }

    // The chart is drawn, not composed, so it has to be told about the reader's text size itself.
    val textScale = LocalDensity.current.fontScale
    LaunchedEffect(textScale) { viewModel.onTextScaleChanged(textScale) }

    val treeIsEmpty = state.treeIsEmpty && wholeState.isEmpty

    /*
     * On a short window the chart's own furniture is folded into one row.
     *
     * A title bar, a mode switch and a line of counts is a reasonable third of a phone held
     * upright and most of it held sideways. The title goes first — the chart is the screen you are
     * on, and the navigation already says so — then the counts, which describe the record rather
     * than what is being looked at and are a rotation away.
     */
    val short = isShortWindow()

    val onModeChange: (ChartMode) -> Unit = {
        mode = it
        // Clearing the fade on the way out means the other views are never entered with two thirds
        // of the record greyed from a selection you cannot see.
        if (it.isAroundOnePerson) wholeTreeViewModel.select(null)
    }

    /*
     * A sheet that the chart lives behind rather than under.
     *
     * Standard rather than modal, because a modal one would put a scrim over the very thing the
     * answer is about. The chart keeps its gestures while the sheet is up, which is what lets a
     * tap on somebody's card fill the other half of the question.
     */
    val sheetState = rememberBottomSheetScaffoldState(
        bottomSheetState = rememberStandardBottomSheetState(
            initialValue = SheetValue.PartiallyExpanded,
            /*
             * The sheet is never hidden; when there is no question its fold is nothing, so there is
             * nothing to see or to take hold of. Keeping one state rather than two means changing
             * the height of the fold — which happens as soon as an answer arrives — cannot be
             * mistaken for the reader dismissing it, which is exactly what a hideable sheet did.
             */
            skipHiddenState = true,
        )
    )
    LaunchedEffect(relating, picking) {
        when {
            picking != null -> sheetState.bottomSheetState.expand()
            else -> sheetState.bottomSheetState.partialExpand()
        }
    }
    BackHandler(enabled = relating) {
        if (picking != null) picking = null else closeRelation()
    }

    BottomSheetScaffold(
        modifier = modifier,
        scaffoldState = sheetState,
        sheetPeekHeight = if (relating) fold + SHEET_HANDLE else 0.dp,
        sheetSwipeEnabled = relating,
        sheetContent = {
            RelationSheet(
                /*
                 * Composed even when there is no question, because the height of the fold is
                 * measured from this content and a sheet cannot measure what it has not laid out.
                 * Silenced instead: a sheet folded to nothing is still a sheet, and left as it was
                 * its sentence and its list of people stay reachable by a screen reader that would
                 * be read an answer nobody asked for and nobody can see.
                 */
                modifier = if (relating) Modifier else Modifier.clearAndSetSemantics {},
                state = relation,
                query = relationQuery,
                picking = picking,
                onStartPicking = { picking = it },
                onStopPicking = { picking = null },
                onChoose = { slot, id ->
                    relationViewModel.choose(slot, id)
                    picking = null
                },
                onQueryChange = relationViewModel::onQueryChange,
                onSwap = relationViewModel::swap,
                onOpenPerson = onOpenPerson,
                onShare = { sharingRelation = true },
                onClose = closeRelation,
                onFoldHeight = { answered, asking ->
                    answerHeight = answered
                    askHeight = asking
                },
            )
        },
        topBar = {
            Column {
                if (!short || treeIsEmpty) {
                    CenterAlignedTopAppBar(
                        title = { Text(stringResource(R.string.tree_title)) },
                        actions = {
                            if (!treeIsEmpty) {
                                ChartActions(
                                    showRelate = true,
                                    showMore = mode.isAroundOnePerson && state.layout.truncated,
                                    showFrame = mode.isDrawn,
                                    onRelate = { openRelation(null) },
                                    onMore = viewModel::showMoreGenerations,
                                    onFrame = { frameSignal++ },
                                )
                            }
                        },
                    )
                }
                if (!treeIsEmpty) {
                    ChartModeBar(
                        mode = mode,
                        onModeChange = onModeChange,
                        summary = wholeSummary(wholeState)
                            .takeIf { mode == ChartMode.WHOLE && !short },
                        compact = short,
                        actions = if (!short) null else ({
                            ChartActions(
                                showRelate = true,
                                showMore = mode.isAroundOnePerson && state.layout.truncated,
                                showFrame = mode.isDrawn,
                                onRelate = { openRelation(null) },
                                onMore = viewModel::showMoreGenerations,
                                onFrame = { frameSignal++ },
                            )
                        }),
                    )
                }
            }
        },
    ) { padding ->
        Box(
            Modifier
                .fillMaxSize()
                /*
                 * The chart gives up the height the sheet stands in rather than being covered by
                 * it: a line traced across a family is no use drawn behind an opaque panel, and a
                 * smaller viewport means the chart's own framing puts the line in what is left.
                 *
                 * The scaffold's own padding is that height — it already counts the fold — so
                 * subtracting it a second time here is how the chart ended up with a fifth of the
                 * screen and a line pinned to the corner of it.
                 */
                .padding(padding)
        ) {
            when {
                treeIsEmpty -> EmptyState(
                    title = stringResource(R.string.empty_title),
                    body = stringResource(R.string.empty_body),
                    actionLabel = stringResource(R.string.empty_action),
                    onAction = onAddPerson,
                    illustration = { TreeGlyph() },
                )

                mode == ChartMode.COMPACT -> when {
                    state.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    else -> CompactFamilyView(
                        family = state.compact,
                        onWalkTo = viewModel::focusOn,
                        // The centre opens the same sheet the charts open, rather than a second
                        // set of actions that would drift out of step with them.
                        onPersonActions = { selected = it },
                        onAddRelative = { kind ->
                            state.compact.focus?.let { onAddRelative(it.person.id, kind) }
                        },
                        onShowMoreGenerations = viewModel::showMoreGenerations,
                    )
                }

                mode == ChartMode.FOCUSED -> when {
                    state.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    else -> FamilyChart(
                        layout = state.layout,
                        onSelect = { if (relating) relationViewModel.name(it.id) else selected = it },
                        photos = photos,
                        frameSignal = frameSignal,
                    )
                }

                else -> when {
                    wholeState.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    // While a line is traced it is what the chart lights up. Letting a tap
                    // replace it with that person's neighbours would throw away the answer the
                    // reader came here to look at.
                    else -> WholeFamilyChart(
                        layout = wholeState.layout,
                        selectedId = wholeSelection?.id,
                        // Nothing to fade while tracing: everybody drawn is on the line.
                        highlighted = if (tracing.isNotEmpty()) emptySet() else highlighted,
                        tracing = tracing.isNotEmpty(),
                        photos = photos,
                        frameSignal = frameSignal,
                        /*
                         * The chart is the other picker.
                         *
                         * A name in a list is a poor way to find somebody in a family you are
                         * already looking at, so while the question is open a tap fills the next
                         * empty side of it. This is why the sheet is not a modal one: the thing
                         * you choose from has to stay live underneath.
                         */
                        onSelect = {
                            if (relating) {
                                relationViewModel.name(it.id)
                            } else {
                                wholeTreeViewModel.select(it)
                                selected = it
                            }
                        },
                    )
                }
            }

            if (!treeIsEmpty && !relating) {
                FloatingActionButton(
                    onClick = onAddPerson,
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(16.dp)
                        .testTag(TreeAddButtonTag),
                ) {
                    Icon(Icons.Default.Add, contentDescription = stringResource(R.string.people_add))
                }
            }
        }
    }

    val found = relation.relation as? Relation.Found
    if (sharingRelation && found != null) {
        ShareCard(state = relation, relation = found, onDismiss = { sharingRelation = false })
    }

    selected?.let { person ->
        ModalBottomSheet(
            onDismissRequest = { selected = null },
            sheetState = personSheetState,
        ) {
            PersonActions(
                person = person,
                isFocus = mode.isAroundOnePerson && person.id == state.layout.focusId,
                onOpen = {
                    selected = null
                    onOpenPerson(person.id)
                },
                onFocus = {
                    selected = null
                    // Only offered from the whole-tree chart — the two one-person views are already
                    // centred on whoever the sheet was opened for — so this always means "leave the
                    // archive and show me this person's family".
                    mode = ChartMode.FOCUSED
                    wholeTreeViewModel.select(null)
                    viewModel.focusOn(person.id)
                },
                onRelate = {
                    selected = null
                    openRelation(person.id)
                },
                onShare = {
                    selected = null
                    onShare(person.id)
                },
                onAddRelative = { kind ->
                    selected = null
                    onAddRelative(person.id, kind)
                },
            )
        }
    }
}

/**
 * The switch between the two charts, with what the whole-tree one has to say about the record
 * underneath it.
 *
 * The counts are the point of the second view as much as the drawing is: "four people here have no
 * recorded relatives" is a fact about the archive that the focused chart can never surface.
 */
@Composable
private fun ChartModeBar(
    mode: ChartMode,
    onModeChange: (ChartMode) -> Unit,
    summary: String?,
    /** Fold the switch, the app bar's actions and the way out of a trace into a single row. */
    compact: Boolean = false,
    actions: (@Composable RowScope.() -> Unit)? = null,
) {
    val modeSwitch: @Composable (Modifier) -> Unit = { switchModifier ->
        SingleChoiceSegmentedButtonRow(modifier = switchModifier) {
            ChartMode.entries.forEachIndexed { index, entry ->
                SegmentedButton(
                    selected = mode == entry,
                    onClick = { onModeChange(entry) },
                    shape = SegmentedButtonDefaults.itemShape(index = index, count = ChartMode.entries.size),
                    modifier = Modifier.testTag(entry.tag),
                ) {
                    // One line, always. A wrapped segment makes the whole control taller and the
                    // chart shorter, which is the opposite of what any of these three views is for.
                    Text(
                        text = stringResource(entry.label),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
            }
        }
    }

    Column(Modifier.fillMaxWidth()) {
        if (compact) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 12.dp, end = 4.dp, top = 4.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                // Capped rather than stretched: the switch is two words wide and a landscape screen
                // is not, and what is left over belongs to the chart rather than to the furniture.
                modeSwitch(Modifier.widthIn(min = 340.dp, max = 420.dp))
                Spacer(Modifier.weight(1f))
                actions?.invoke(this)
            }
        } else {
            modeSwitch(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 4.dp))
            summary?.let {
                Text(
                    text = it,
                    style = FTreeText.recordSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 24.dp, vertical = 6.dp),
                )
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
    }
}

/**
 * The chart's two app-bar actions, wherever the bar happens to be.
 *
 * Written once because on a short window they move out of the title bar and into the mode row, and
 * an action that changes what it does depending on where it is drawn would be a bug waiting to be
 * written.
 */
@Composable
private fun ChartActions(
    showRelate: Boolean,
    showMore: Boolean,
    showFrame: Boolean,
    onRelate: () -> Unit,
    onMore: () -> Unit,
    onFrame: () -> Unit,
) {
    if (showFrame) {
        IconButton(onClick = onFrame, modifier = Modifier.testTag(TreeFrameTag)) {
            Icon(
                Icons.Default.FitScreen,
                contentDescription = stringResource(R.string.tree_recentre),
            )
        }
    }
    if (showRelate) {
        IconButton(onClick = onRelate, modifier = Modifier.testTag(TreeRelateTag)) {
            Icon(
                Icons.Default.CompareArrows,
                contentDescription = stringResource(R.string.relation_find),
            )
        }
    }
    if (showMore) {
        IconButton(onClick = onMore) {
            Icon(
                Icons.Default.UnfoldMore,
                contentDescription = stringResource(R.string.tree_more_generations),
            )
        }
    }
}

@Composable
private fun wholeSummary(state: WholeTreeUiState): String {
    if (state.loading) return ""
    val parts = buildList {
        add(pluralStringResource(R.plurals.whole_summary, state.peopleCount, state.peopleCount))
        if (state.familyCount > 0) {
            add(pluralStringResource(R.plurals.whole_summary_families, state.familyCount, state.familyCount))
        }
        if (state.unnamedCount > 0) {
            add(pluralStringResource(R.plurals.whole_summary_unnamed, state.unnamedCount, state.unnamedCount))
        }
        if (state.unconnectedCount > 0) {
            add(pluralStringResource(R.plurals.whole_summary_unconnected, state.unconnectedCount, state.unconnectedCount))
        }
    }
    return parts.joinToString("  ·  ")
}

/**
 * What you can do with the person you tapped.
 *
 * "Centre the tree here" is the important one: it is how the rest of a family that does not fit on
 * one chart stays reachable, so it sits above opening their page.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PersonActions(
    person: Person,
    isFocus: Boolean,
    onOpen: () -> Unit,
    onFocus: () -> Unit,
    onRelate: () -> Unit,
    onShare: () -> Unit,
    onAddRelative: (RelativeKind) -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxWidth().navigationBarsPadding().padding(bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        PersonRow(person = person, onClick = onOpen)

        if (!isFocus) {
            SheetAction(
                icon = { Icon(Icons.Default.CenterFocusStrong, contentDescription = null) },
                label = stringResource(R.string.tree_focus_here),
                tag = TreeFocusHereTag,
                onClick = onFocus,
            )
        }
        SheetAction(
            icon = { Icon(Icons.AutoMirrored.Filled.List, contentDescription = null) },
            label = stringResource(R.string.tree_open_person, person.displayName()),
            tag = TreeOpenPersonTag,
            onClick = onOpen,
        )
        SheetAction(
            icon = { Icon(Icons.Default.CompareArrows, contentDescription = null) },
            label = stringResource(R.string.relation_open_from_person),
            tag = TreeRelateFromTag,
            onClick = onRelate,
        )
        SheetAction(
            icon = { Icon(Icons.Default.Share, contentDescription = null) },
            label = stringResource(R.string.share_branch),
            tag = TreeShareTag,
            onClick = onShare,
        )
        // Naming the four kinds outright is one tap either way, and avoids the sheet quietly
        // choosing "parent" on the user's behalf.
        Text(
            text = stringResource(R.string.tree_add_relative),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 24.dp, top = 12.dp, bottom = 4.dp),
        )
        FlowRow(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            RelativeKind.entries.forEach { kind ->
                AssistChip(
                    onClick = { onAddRelative(kind) },
                    label = { Text(stringResource(relativeKindLabel(kind))) },
                    leadingIcon = {
                        Icon(
                            Icons.Default.PersonAddAlt,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                    },
                    modifier = Modifier.testTag("tree-add-" + kind.name.lowercase()),
                )
            }
        }
    }
}

@Composable
private fun SheetAction(
    icon: @Composable () -> Unit,
    label: String,
    tag: String,
    onClick: () -> Unit,
) {
    TextButton(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp).testTag(tag),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            icon()
            Text(label, style = MaterialTheme.typography.bodyLarge)
        }
    }
}
