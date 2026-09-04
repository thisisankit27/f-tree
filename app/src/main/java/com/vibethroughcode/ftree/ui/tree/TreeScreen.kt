package com.vibethroughcode.ftree.ui.tree

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CenterFocusStrong
import androidx.compose.material.icons.filled.PersonAddAlt
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
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
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
import com.vibethroughcode.ftree.ui.common.relativeKindLabel
import com.vibethroughcode.ftree.ui.theme.FTreeText

const val TreeAddButtonTag = "tree-add"
const val TreeFocusHereTag = "tree-focus-here"
const val TreeOpenPersonTag = "tree-open-person"
const val TreeModeFocusedTag = "tree-mode-focused"
const val TreeModeWholeTag = "tree-mode-whole"

/**
 * Which chart is on screen.
 *
 * Two answers to two different questions, not two settings. [FOCUSED] answers "who is around this
 * person", which is what you want while adding relatives. [WHOLE] answers "what is in this record",
 * which is a question the focused chart structurally cannot answer, because the people in the
 * answer are exactly the ones it never draws.
 */
private enum class ChartMode { FOCUSED, WHOLE }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TreeScreen(
    onOpenPerson: (String) -> Unit,
    onAddPerson: () -> Unit,
    onAddRelative: (String, RelativeKind) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: TreeViewModel = viewModel(factory = FTreeViewModels.Factory),
    wholeTreeViewModel: WholeTreeViewModel = viewModel(factory = FTreeViewModels.Factory),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val wholeState by wholeTreeViewModel.uiState.collectAsStateWithLifecycle()
    val highlighted by wholeTreeViewModel.highlighted.collectAsStateWithLifecycle()
    val wholeSelection by wholeTreeViewModel.selected.collectAsStateWithLifecycle()

    var mode by rememberSaveable { mutableStateOf(ChartMode.FOCUSED) }
    var selected by remember { mutableStateOf<Person?>(null) }
    val sheetState = rememberModalBottomSheetState()

    // The chart is drawn, not composed, so it has to be told about the reader's text size itself.
    val textScale = LocalDensity.current.fontScale
    LaunchedEffect(textScale) { viewModel.onTextScaleChanged(textScale) }

    val treeIsEmpty = state.treeIsEmpty && wholeState.isEmpty

    Scaffold(
        modifier = modifier,
        topBar = {
            Column {
                CenterAlignedTopAppBar(
                    title = { Text(stringResource(R.string.tree_title)) },
                    actions = {
                        if (mode == ChartMode.FOCUSED && state.layout.truncated) {
                            IconButton(onClick = viewModel::showMoreGenerations) {
                                Icon(
                                    Icons.Default.UnfoldMore,
                                    contentDescription = stringResource(R.string.tree_more_generations),
                                )
                            }
                        }
                    },
                )
                if (!treeIsEmpty) {
                    ChartModeBar(
                        mode = mode,
                        onModeChange = {
                            mode = it
                            // Clearing the fade on the way out means the other chart is never
                            // entered with two thirds of it greyed from a selection you cannot see.
                            if (it == ChartMode.FOCUSED) wholeTreeViewModel.select(null)
                        },
                        summary = wholeSummary(wholeState).takeIf { mode == ChartMode.WHOLE },
                    )
                }
            }
        },
        floatingActionButton = {
            if (!treeIsEmpty) {
                FloatingActionButton(
                    onClick = onAddPerson,
                    modifier = Modifier.testTag(TreeAddButtonTag),
                ) {
                    Icon(Icons.Default.Add, contentDescription = stringResource(R.string.people_add))
                }
            }
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                treeIsEmpty -> EmptyState(
                    title = stringResource(R.string.empty_title),
                    body = stringResource(R.string.empty_body),
                    actionLabel = stringResource(R.string.empty_action),
                    onAction = onAddPerson,
                    illustration = { TreeGlyph() },
                )

                mode == ChartMode.FOCUSED -> when {
                    state.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    else -> FamilyChart(layout = state.layout, onSelect = { selected = it })
                }

                else -> when {
                    wholeState.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))
                    else -> WholeFamilyChart(
                        layout = wholeState.layout,
                        selectedId = wholeSelection?.id,
                        highlighted = highlighted,
                        onSelect = {
                            wholeTreeViewModel.select(it)
                            selected = it
                        },
                    )
                }
            }
        }
    }

    selected?.let { person ->
        ModalBottomSheet(
            onDismissRequest = { selected = null },
            sheetState = sheetState,
        ) {
            PersonActions(
                person = person,
                isFocus = mode == ChartMode.FOCUSED && person.id == state.layout.focusId,
                onOpen = {
                    selected = null
                    onOpenPerson(person.id)
                },
                onFocus = {
                    selected = null
                    // Centring is a focused-chart idea, so asking for it takes you there.
                    mode = ChartMode.FOCUSED
                    wholeTreeViewModel.select(null)
                    viewModel.focusOn(person.id)
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
) {
    Column(Modifier.fillMaxWidth()) {
        SingleChoiceSegmentedButtonRow(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp, vertical = 4.dp),
        ) {
            SegmentedButton(
                selected = mode == ChartMode.FOCUSED,
                onClick = { onModeChange(ChartMode.FOCUSED) },
                shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
                modifier = Modifier.testTag(TreeModeFocusedTag),
            ) { Text(stringResource(R.string.tree_mode_focused)) }

            SegmentedButton(
                selected = mode == ChartMode.WHOLE,
                onClick = { onModeChange(ChartMode.WHOLE) },
                shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
                modifier = Modifier.testTag(TreeModeWholeTag),
            ) { Text(stringResource(R.string.tree_mode_whole)) }
        }

        summary?.let {
            Text(
                text = it,
                style = FTreeText.recordSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 6.dp),
            )
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
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
