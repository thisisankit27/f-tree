package com.vibethroughcode.ftree.ui.tree

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
import androidx.compose.material.icons.filled.PersonAddAlt
import androidx.compose.material.icons.filled.UnfoldMore
import androidx.compose.material3.AssistChip
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
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

const val TreePeopleButtonTag = "tree-people"
const val TreeAddButtonTag = "tree-add"
const val TreeFocusHereTag = "tree-focus-here"
const val TreeOpenPersonTag = "tree-open-person"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TreeScreen(
    onOpenPerson: (String) -> Unit,
    onOpenPeople: () -> Unit,
    onAddPerson: () -> Unit,
    onAddRelative: (String, RelativeKind) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: TreeViewModel = viewModel(factory = FTreeViewModels.Factory),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var selected by remember { mutableStateOf<Person?>(null) }
    val sheetState = rememberModalBottomSheetState()

    Scaffold(
        modifier = modifier,
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
