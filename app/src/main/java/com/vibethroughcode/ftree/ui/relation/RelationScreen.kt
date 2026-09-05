package com.vibethroughcode.ftree.ui.relation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.PersonSearch
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.graph.Relation
import com.vibethroughcode.ftree.ui.FTreeViewModels
import com.vibethroughcode.ftree.ui.common.PersonAvatar
import com.vibethroughcode.ftree.ui.common.PersonRow
import com.vibethroughcode.ftree.ui.common.SectionRule
import com.vibethroughcode.ftree.ui.common.displayName
import com.vibethroughcode.ftree.ui.common.kinshipLabel
import com.vibethroughcode.ftree.ui.common.relativeRoleLabel
import com.vibethroughcode.ftree.ui.common.asRelativeKind
import com.vibethroughcode.ftree.ui.theme.FTreeText
import com.vibethroughcode.ftree.ui.theme.FTreeTheme

const val RelationSlotFromTag = "relation-slot-from"
const val RelationSlotToTag = "relation-slot-to"
const val RelationSwapTag = "relation-swap"
const val RelationAnswerTag = "relation-answer"
const val RelationChainTag = "relation-chain"
const val RelationPickListTag = "relation-pick-list"
const val RelationPickSearchTag = "relation-pick-search"
const val RelationShowOnChartTag = "relation-show-on-chart"

/**
 * How two people are related.
 *
 * Answered in two registers at once, because they are believed differently. The sentence — "Priya
 * is Ankit's first cousin once removed" — is the answer somebody came for, and English has no
 * phrase for most of the ways a family actually joins up. The chain underneath is the working:
 * every person the line passes through, which is checkable against a reader's own memory and is
 * the only form that can express in-laws and step-relations. So the chain is always shown, and the
 * sentence only when there is one to give.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RelationScreen(
    onBack: () -> Unit,
    onOpenPerson: (String) -> Unit,
    onShowOnChart: (List<String>) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: RelationViewModel = viewModel(factory = FTreeViewModels.Factory),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val query by viewModel.currentQuery.collectAsStateWithLifecycle()
    var picking by rememberSaveable { mutableStateOf<RelationSlot?>(null) }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        stringResource(
                            if (picking != null) R.string.relation_pick_title
                            else R.string.relation_title
                        )
                    )
                },
                navigationIcon = {
                    IconButton(onClick = { if (picking != null) picking = null else onBack() }) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.edit_back),
                        )
                    }
                },
            )
        },
    ) { padding ->
        Box(Modifier.fillMaxSize().padding(padding)) {
            when {
                state.treeIsEmpty -> Text(
                    text = stringResource(R.string.empty_body),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.align(Alignment.Center).padding(32.dp),
                )

                picking != null -> PersonPicker(
                    people = state.candidates,
                    query = query,
                    onQueryChange = viewModel::onQueryChange,
                    onPick = { id ->
                        viewModel.choose(picking!!, id)
                        picking = null
                    },
                )

                else -> Answer(
                    state = state,
                    onPick = { picking = it },
                    onSwap = viewModel::swap,
                    onOpenPerson = onOpenPerson,
                    onShowOnChart = { onShowOnChart(state.trace) },
                )
            }
        }
    }
}

@Composable
private fun Answer(
    state: RelationUiState,
    onPick: (RelationSlot) -> Unit,
    onSwap: () -> Unit,
    onOpenPerson: (String) -> Unit,
    onShowOnChart: () -> Unit,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 40.dp),
    ) {
        item {
            /*
             * The two slots read as one phrase down the page — "Between … and …" — which says
             * plainly that this is a question about a pair, and leaves the direction to the answer
             * sentence rather than making the reader decode two field labels first.
             */
            Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
                Slot(
                    label = stringResource(R.string.relation_between),
                    person = state.from,
                    tag = RelationSlotFromTag,
                    onClick = { onPick(RelationSlot.FROM) },
                )
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = stringResource(R.string.relation_and),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f),
                    )
                    if (state.bothChosen) {
                        IconButton(onClick = onSwap, modifier = Modifier.testTag(RelationSwapTag)) {
                            Icon(
                                Icons.Default.SwapVert,
                                contentDescription = stringResource(R.string.relation_swap),
                            )
                        }
                    }
                }
                Slot(
                    label = null,
                    person = state.to,
                    tag = RelationSlotToTag,
                    onClick = { onPick(RelationSlot.TO) },
                )
            }
        }

        item { Verdict(state) }

        if (state.chain.isNotEmpty() && state.from != null) {
            item {
                Column(Modifier.padding(top = 8.dp)) {
                    SectionRule(stringResource(R.string.relation_chain_title))
                }
            }
            item {
                PersonRow(
                    person = state.from,
                    onClick = { onOpenPerson(state.from.id) },
                    supporting = stringResource(R.string.relation_chain_start),
                    modifier = Modifier.testTag(RelationChainTag),
                )
            }
            itemsIndexed(state.chain, key = { _, link -> link.person.id }) { index, link ->
                ChainRow(
                    link = link,
                    previous = if (index == 0) state.from else state.chain[index - 1].person,
                    onClick = { onOpenPerson(link.person.id) },
                )
            }
            item {
                Button(
                    onClick = onShowOnChart,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 20.dp, vertical = 16.dp)
                        .testTag(RelationShowOnChartTag),
                ) {
                    Icon(Icons.Default.AccountTree, contentDescription = null)
                    Text(
                        text = stringResource(R.string.relation_show_on_chart),
                        modifier = Modifier.padding(start = 12.dp),
                    )
                }
            }
        }
    }
}

/**
 * Each person on the line, and what they are to the one before them.
 *
 * "Father of Vinod Kumar" rather than a bare "Father": the chain is only useful if each row can be
 * checked against what the reader already knows, and that needs both ends of the step named.
 */
@Composable
private fun ChainRow(link: ChainLink, previous: Person, onClick: () -> Unit) {
    val role = stringResource(relativeRoleLabel(link.kind.asRelativeKind(), link.person.gender))
    PersonRow(
        person = link.person,
        onClick = onClick,
        supporting = stringResource(R.string.relation_chain_step, role, previous.displayName()),
    )
}

/** The sentence, and how far apart the two of them are. */
@Composable
private fun Verdict(state: RelationUiState) {
    val from = state.from
    val to = state.to
    val accents = FTreeTheme.accents

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 8.dp)
            .testTag(RelationAnswerTag),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        ),
    ) {
        Column(
            modifier = Modifier.padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            when (val relation = state.relation) {
                null -> Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(
                        Icons.Default.PersonSearch,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.size(24.dp),
                    )
                    Text(
                        text = stringResource(R.string.relation_hint),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 16.dp),
                    )
                }

                Relation.SamePerson -> Text(
                    text = stringResource(R.string.relation_answer_same),
                    style = MaterialTheme.typography.titleMedium,
                )

                Relation.Unrecorded -> {
                    Text(
                        text = stringResource(
                            R.string.relation_answer_none,
                            from?.displayName().orEmpty(),
                            to?.displayName().orEmpty(),
                        ),
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        text = stringResource(R.string.relation_answer_none_body),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                is Relation.Found -> {
                    val toName = to?.displayName().orEmpty()
                    val fromName = from?.displayName().orEmpty()
                    Text(
                        text = when {
                            relation.term != null && to != null -> stringResource(
                                R.string.relation_answer_term,
                                toName,
                                fromName,
                                kinshipLabel(relation.term, to.gender),
                            )

                            relation.byMarriage ->
                                stringResource(R.string.relation_answer_marriage, toName, fromName)

                            else -> stringResource(R.string.relation_answer_linked, toName, fromName)
                        },
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        text = pluralStringResource(
                            R.plurals.relation_steps,
                            relation.steps,
                            relation.steps,
                        ),
                        style = FTreeText.recordSmall,
                        color = accents.unknown,
                    )
                    state.sharedAncestor?.let { ancestor ->
                        Text(
                            text = stringResource(
                                R.string.relation_shared_ancestor,
                                ancestor.displayName(),
                            ),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }
        }
    }
}

/** One of the two people, or an invitation to choose one. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Slot(
    label: String?,
    person: Person?,
    tag: String,
    onClick: () -> Unit,
) {
    Column {
        label?.let {
            Text(
                text = it,
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(bottom = 4.dp),
            )
        }
        Card(
            onClick = onClick,
            modifier = Modifier.fillMaxWidth().testTag(tag),
            colors = CardDefaults.cardColors(
                containerColor = MaterialTheme.colorScheme.surface,
            ),
            border = CardDefaults.outlinedCardBorder(),
        ) {
            if (person == null) {
                Row(
                    modifier = Modifier.fillMaxWidth().height(64.dp).padding(horizontal = 20.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(
                        Icons.Default.PersonSearch,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = stringResource(R.string.relation_choose),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 16.dp),
                    )
                }
            } else {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    PersonAvatar(person)
                    Text(
                        text = person.displayName(),
                        style = MaterialTheme.typography.titleMedium,
                        fontStyle = if (person.isUnnamed) FontStyle.Italic else FontStyle.Normal,
                        modifier = Modifier.weight(1f).padding(start = 16.dp),
                    )
                    Text(
                        text = stringResource(R.string.relation_change),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }
}

/** The whole tree, searchable — including the people no relationship reaches. */
@Composable
private fun PersonPicker(
    people: List<Person>,
    query: String,
    onQueryChange: (String) -> Unit,
    onPick: (String) -> Unit,
) {
    val focusRequester = remember { FocusRequester() }
    LaunchedEffect(Unit) { focusRequester.requestFocus() }

    Column(Modifier.fillMaxSize()) {
        OutlinedTextField(
            value = query,
            onValueChange = onQueryChange,
            placeholder = { Text(stringResource(R.string.relation_pick_hint)) },
            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
            singleLine = true,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp)
                .focusRequester(focusRequester)
                .testTag(RelationPickSearchTag),
        )
        if (people.isEmpty()) {
            Text(
                text = stringResource(R.string.relation_pick_none),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth().padding(32.dp),
            )
        } else {
            LazyColumn(Modifier.fillMaxSize().testTag(RelationPickListTag)) {
                items(people, key = { it.id }) { person ->
                    PersonRow(person = person, onClick = { onPick(person.id) })
                }
            }
        }
    }
}
