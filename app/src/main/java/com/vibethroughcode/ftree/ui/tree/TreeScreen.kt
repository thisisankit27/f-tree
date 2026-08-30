package com.vibethroughcode.ftree.ui.tree

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CenterFocusStrong
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.PersonAddAlt
import androidx.compose.material.icons.filled.UnfoldMore
import androidx.compose.material3.AssistChip
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
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
import com.vibethroughcode.ftree.transfer.TreeDocument
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.vibethroughcode.ftree.ui.transfer.ImportReviewScreen
import com.vibethroughcode.ftree.ui.transfer.TransferMessages
import com.vibethroughcode.ftree.ui.transfer.TransferViewModel
import com.vibethroughcode.ftree.ui.transfer.defaultExportName

const val TreePeopleButtonTag = "tree-people"
const val TreeAddButtonTag = "tree-add"
const val TreeMenuTag = "tree-menu"
const val TreeExportTag = "tree-export"
const val TreeImportTag = "tree-import"
const val TreeFocusHereTag = "tree-focus-here"
const val TreeOpenPersonTag = "tree-open-person"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TreeScreen(
    onOpenPerson: (String) -> Unit,
    onOpenPeople: () -> Unit,
    onAddPerson: () -> Unit,
    onAddRelative: (String, RelativeKind) -> Unit,
    onAbout: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: TreeViewModel = viewModel(factory = FTreeViewModels.Factory),
    transferViewModel: TransferViewModel = viewModel(factory = FTreeViewModels.Factory),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var selected by remember { mutableStateOf<Person?>(null) }
    var menuOpen by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }

    // Export owns its result message, so the snackbar host lives on the screen that shows it.
    val exportPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument(TreeDocument.MIME_TYPE)
    ) { uri -> uri?.let(transferViewModel::export) }

    // Any type is accepted: providers disagree about what a .ftree file is, and refusing to show
    // the user's own export because a provider called it octet-stream would be absurd. The file
    // itself is validated on read.
    val importPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri -> uri?.let(transferViewModel::prepareImport) }

    TransferMessages(transferViewModel, snackbarHostState)

    val importPlan by transferViewModel.plan.collectAsStateWithLifecycle()
    val importDecisions by transferViewModel.decisions.collectAsStateWithLifecycle()
    val allPeople by viewModel.allPeople.collectAsStateWithLifecycle()

    // The chart is drawn, not composed, so it has to be told about the reader's text size itself.
    val textScale = LocalDensity.current.fontScale
    LaunchedEffect(textScale) { viewModel.onTextScaleChanged(textScale) }
    val sheetState = rememberModalBottomSheetState()

    Scaffold(
        modifier = modifier,
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text(stringResource(R.string.tree_title)) },
                actions = {
                    if (state.layout.truncated) {
                        IconButton(onClick = viewModel::showMoreGenerations) {
                            Icon(
                                Icons.Default.UnfoldMore,
                                contentDescription = stringResource(R.string.tree_more_generations),
                            )
                        }
                    }
                    IconButton(
                        onClick = onOpenPeople,
                        modifier = Modifier.testTag(TreePeopleButtonTag),
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.List,
                            contentDescription = stringResource(R.string.tree_people),
                        )
                    }
                    IconButton(
                        onClick = { menuOpen = true },
                        modifier = Modifier.testTag(TreeMenuTag),
                    ) {
                        Icon(
                            Icons.Default.MoreVert,
                            contentDescription = stringResource(R.string.menu_more),
                        )
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.export_tree)) },
                            onClick = { menuOpen = false; exportPicker.launch(defaultExportName()) },
                            modifier = Modifier.testTag(TreeExportTag),
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.import_tree)) },
                            onClick = {
                                menuOpen = false
                                importPicker.launch(arrayOf("*/*"))
                            },
                            modifier = Modifier.testTag(TreeImportTag),
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.about)) },
                            onClick = { menuOpen = false; onAbout() },
                        )
                    }
                },
            )
        },
        floatingActionButton = {
            if (!state.treeIsEmpty) {
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
                state.loading -> CircularProgressIndicator(Modifier.align(Alignment.Center))

                state.treeIsEmpty -> EmptyState(
                    title = stringResource(R.string.empty_title),
                    body = stringResource(R.string.empty_body),
                    actionLabel = stringResource(R.string.empty_action),
                    onAction = onAddPerson,
                    illustration = { TreeGlyph() },
                )

                else -> FamilyChart(
                    layout = state.layout,
                    onSelect = { selected = it },
                )
            }
        }
    }

    // Shown over the chart rather than as a navigation destination: the plan is a live object that
    // cannot be handed through a route, and backing out must leave the tree untouched.
    importPlan?.let { plan ->
        Dialog(
            onDismissRequest = transferViewModel::cancelImport,
            properties = DialogProperties(
                usePlatformDefaultWidth = false,
                // Fills the screen properly instead of leaving the scrim showing behind the
                // status and navigation bars.
                decorFitsSystemWindows = false,
            ),
        ) {
            ImportReviewScreen(
                plan = plan,
                decisions = importDecisions,
                localPeople = allPeople,
                onDecision = transferViewModel::setDecision,
                onConfirm = transferViewModel::confirmImport,
                onCancel = transferViewModel::cancelImport,
            )
        }
    }

    selected?.let { person ->
        ModalBottomSheet(
            onDismissRequest = { selected = null },
            sheetState = sheetState,
        ) {
            PersonActions(
                person = person,
                isFocus = person.id == state.layout.focusId,
                onOpen = {
                    selected = null
                    onOpenPerson(person.id)
                },
                onFocus = {
                    selected = null
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
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            icon()
            Text(text = label, style = MaterialTheme.typography.bodyLarge)
        }
    }
}
