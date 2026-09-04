package com.vibethroughcode.ftree.ui.people

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.FilterChip
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.ui.FTreeViewModels
import com.vibethroughcode.ftree.ui.common.EmptyState
import com.vibethroughcode.ftree.ui.common.PersonRow
import com.vibethroughcode.ftree.ui.common.peopleCount
import com.vibethroughcode.ftree.ui.common.TreeGlyph
import com.vibethroughcode.ftree.ui.theme.FTreeText

const val PeopleFilterEveryoneTag = "people-filter-everyone"
const val PeopleFilterLivingTag = "people-filter-living"
const val PeopleCountTag = "people-count"
const val PeopleListTag = "people-list"
const val PeopleSearchFieldTag = "people-search-field"
const val PeopleAddFabTag = "people-add-fab"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PeopleScreen(
    onOpenPerson: (String) -> Unit,
    onAddPerson: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PeopleViewModel = viewModel(factory = FTreeViewModels.Factory),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var searching by rememberSaveable { mutableStateOf(false) }
    val focusRequester = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current

    LaunchedEffect(searching) {
        if (searching) focusRequester.requestFocus()
    }

    Scaffold(
        modifier = modifier,
        topBar = {
            if (searching) {
                OutlinedTextField(
                    value = state.query,
                    onValueChange = viewModel::onQueryChange,
                    placeholder = { Text(stringResource(R.string.people_search_hint)) },
                    singleLine = true,
                    leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                    trailingIcon = {
                        IconButton(onClick = {
                            viewModel.onQueryChange("")
                            searching = false
                            keyboard?.hide()
                        }) {
                            Icon(
                                Icons.Default.Close,
                                contentDescription = stringResource(R.string.people_search_close),
                            )
                        }
                    },
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { keyboard?.hide() }),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 12.dp, vertical = 8.dp)
                        .focusRequester(focusRequester)
                        .testTag(PeopleSearchFieldTag),
                )
            } else {
                CenterAlignedTopAppBar(
                    title = { Text(stringResource(R.string.people_title)) },
                    actions = {
                        if (state.people.isNotEmpty() || state.query.isNotBlank()) {
                            IconButton(onClick = { searching = true }) {
                                Icon(
                                    Icons.Default.Search,
                                    contentDescription = stringResource(R.string.people_search_open),
                                )
                            }
                        }
                    },
                )
            }
        },
        floatingActionButton = {
            if (!state.isEmptyTree) {
                ExtendedFloatingActionButton(
                    onClick = onAddPerson,
                    modifier = Modifier.testTag(PeopleAddFabTag),
                    icon = { Icon(Icons.Default.Add, contentDescription = null) },
                    text = { Text(stringResource(R.string.people_add)) },
                )
            }
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            if (!state.isEmptyTree) {
                PeopleFilterRow(
                    filter = state.filter,
                    onFilterChange = viewModel::onFilterChange,
                )
            }
            Box(Modifier.fillMaxSize()) {
            when {
                state.isEmptyTree -> EmptyState(
                    title = stringResource(R.string.empty_title),
                    body = stringResource(R.string.empty_body),
                    actionLabel = stringResource(R.string.empty_action),
                    onAction = onAddPerson,
                    illustration = { TreeGlyph() },
                )

                state.hasNoMatches -> Text(
                    text = stringResource(R.string.people_no_matches, state.query),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.align(Alignment.TopCenter).padding(32.dp),
                )

                // Matching nobody and matching only the dead are different answers, and saying
                // "no one matches" to the second would be wrong.
                state.hasNoneLiving -> Text(
                    text = stringResource(R.string.people_none_living),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.align(Alignment.TopCenter).padding(32.dp),
                )

                else -> LazyColumn(
                    modifier = Modifier.fillMaxSize().testTag(PeopleListTag),
                    // Room for the extended FAB to sit over without covering the last row.
                    contentPadding = PaddingValues(bottom = 96.dp),
                ) {
                    items(state.people, key = { it.id }) { person ->
                        PersonRow(person = person, onClick = { onOpenPerson(person.id) })
                    }
                    item {
                        Text(
                            text = countLine(state),
                            style = FTreeText.recordSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(20.dp)
                                .testTag(PeopleCountTag),
                        )
                    }
                }
            }
            }
        }
    }
}

/**
 * Everyone, or only the living.
 *
 * A filter rather than a sort, because "who is still with us" is a question people ask of a family
 * record, and the answer is a shorter list rather than a reordering of the same one.
 */
@Composable
private fun PeopleFilterRow(
    filter: PeopleFilter,
    onFilterChange: (PeopleFilter) -> Unit,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        FilterChip(
            selected = filter == PeopleFilter.EVERYONE,
            onClick = { onFilterChange(PeopleFilter.EVERYONE) },
            label = { Text(stringResource(R.string.people_filter_everyone)) },
            modifier = Modifier.testTag(PeopleFilterEveryoneTag),
        )
        FilterChip(
            selected = filter == PeopleFilter.LIVING,
            onClick = { onFilterChange(PeopleFilter.LIVING) },
            label = { Text(stringResource(R.string.people_filter_living)) },
            modifier = Modifier.testTag(PeopleFilterLivingTag),
        )
    }
}

/** The count under the list, phrased for whichever question is being asked of it. */
@Composable
private fun countLine(state: PeopleUiState): String = when {
    state.filter == PeopleFilter.EVERYONE ->
        stringResource(R.string.people_count, peopleCount(state.people.size))
    // Only the total is pluralised; "11 people living, of 13 people" says people twice.
    state.query.isBlank() -> stringResource(
        R.string.people_count_living,
        state.people.size,
        peopleCount(state.matchCount),
    )
    else -> stringResource(
        R.string.people_count_living_matching,
        state.people.size,
        peopleCount(state.matchCount),
    )
}
