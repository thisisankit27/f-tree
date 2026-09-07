package com.vibethroughcode.ftree.ui.relation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.SwapVert
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.graph.Relation
import com.vibethroughcode.ftree.ui.common.LocalKinshipLanguage
import com.vibethroughcode.ftree.ui.common.PersonAvatar
import com.vibethroughcode.ftree.ui.common.PersonRow
import com.vibethroughcode.ftree.ui.common.SectionRule
import com.vibethroughcode.ftree.ui.common.asRelativeKind
import com.vibethroughcode.ftree.ui.common.displayName
import com.vibethroughcode.ftree.ui.common.isShortWindow
import com.vibethroughcode.ftree.ui.common.relativeRoleLabel
import com.vibethroughcode.ftree.ui.theme.FTreeText
import com.vibethroughcode.ftree.ui.theme.FTreeTheme
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.ui.text.rememberTextMeasurer

const val RelationSheetTag = "relation-sheet"
const val RelationCloseTag = "relation-close"

/**
 * The answer to "how are we related", on top of the chart that is drawing it.
 *
 * It used to be a screen of its own, which split one answer across two places: the sentence and
 * the line of people lived here, the picture of them lived on the chart, and going to look at the
 * picture threw the sentence away. They are two readings of the same fact and neither is complete
 * — the sentence is what somebody came for, the drawing is where they see it sitting in the family
 * — so they are now shown at once, and neither can be navigated away from the other.
 *
 * What is folded down is chosen by what the reader wants at a glance. The sentence and the way to
 * send it stay above the fold; the working — who exactly the line runs through — is a drag away,
 * because it is what you consult rather than what you read. The height of the fold is measured
 * from the sentence itself rather than set to a number, so a long answer, a Hindi term with its
 * gloss, or somebody's larger type all still show whole.
 */
@Composable
fun RelationSheet(
    state: RelationUiState,
    query: String,
    picking: RelationSlot?,
    onStartPicking: (RelationSlot) -> Unit,
    onStopPicking: () -> Unit,
    onChoose: (RelationSlot, String) -> Unit,
    onQueryChange: (String) -> Unit,
    onSwap: () -> Unit,
    onOpenPerson: (String) -> Unit,
    onShare: () -> Unit,
    onClose: () -> Unit,
    /**
     * How much has to stand above the fold, in the two states this sheet has.
     *
     * Once there is an answer that is the sentence; before there is one it is the sentence and the
     * pair, because a question with its two empty slots folded away offers the reader nothing to
     * act on.
     */
    onFoldHeight: (answered: Dp, asking: Dp) -> Unit,
    modifier: Modifier = Modifier,
) {
    if (picking != null) {
        PersonPicker(
            people = state.candidates,
            query = query,
            onQueryChange = onQueryChange,
            onPick = { onChoose(picking, it) },
            onCancel = onStopPicking,
            modifier = modifier,
        )
        return
    }

    val density = LocalDensity.current
    var headline by remember { mutableStateOf(0.dp) }
    var pair by remember { mutableStateOf(0.dp) }
    LaunchedEffect(headline, pair) { onFoldHeight(headline, headline + pair) }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .verticalScroll(rememberScrollState())
            .testTag(RelationSheetTag),
    ) {
        Box(
            Modifier.onSizeChanged { headline = with(density) { it.height.toDp() } }
        ) {
            Headline(state = state, onShare = onShare, onClose = onClose)
        }

        Box(Modifier.onSizeChanged { pair = with(density) { it.height.toDp() } }) {
            Pair(state = state, onPick = onStartPicking, onSwap = onSwap)
        }

        if (state.chain.isNotEmpty() && state.from != null) {
            SectionRule(
                label = stringResource(R.string.relation_chain_title),
                modifier = Modifier.padding(top = 4.dp, start = 20.dp, end = 20.dp),
            )
            PersonRow(
                person = state.from,
                onClick = { onOpenPerson(state.from.id) },
                supporting = stringResource(R.string.relation_chain_start),
                modifier = Modifier.testTag(RelationChainTag),
            )
            state.chain.forEachIndexed { index, link ->
                val previous = if (index == 0) state.from else state.chain[index - 1].person
                val role = stringResource(
                    relativeRoleLabel(
                        link.kind.asRelativeKind(),
                        link.person.gender,
                        LocalKinshipLanguage.current,
                    )
                )
                PersonRow(
                    person = link.person,
                    onClick = { onOpenPerson(link.person.id) },
                    supporting = stringResource(
                        R.string.relation_chain_step,
                        role,
                        previous.displayName(),
                    ),
                )
            }
            Box(Modifier.height(16.dp))
        }
    }
}

/**
 * The part that stays above the fold: what the answer is, and the two things to do with it.
 *
 * Send and close sit beside the sentence rather than under the working, because they are what a
 * reader wants the moment they have read it — and because a button that only exists at the bottom
 * of a list is a button most people never find.
 */
@Composable
private fun Headline(state: RelationUiState, onShare: () -> Unit, onClose: () -> Unit) {
    val accents = FTreeTheme.accents
    val relation = state.relation
    val answer = (relation as? Relation.Found)?.let { answerSentence(state, it) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 20.dp, end = 8.dp)
            .testTag(RelationAnswerTag),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f).padding(top = 4.dp, bottom = 4.dp, end = 8.dp)) {
                Text(
                    text = when {
                        relation == null -> stringResource(R.string.relation_title)
                        relation is Relation.SamePerson ->
                            stringResource(R.string.relation_answer_same)

                        relation is Relation.Unrecorded -> stringResource(
                            R.string.relation_answer_none,
                            state.from?.displayName().orEmpty(),
                            state.to?.displayName().orEmpty(),
                        )

                        else -> answer?.sentence ?: stringResource(
                            R.string.relation_answer_linked,
                            state.to?.displayName().orEmpty(),
                            state.from?.displayName().orEmpty(),
                        )
                    },
                    style = MaterialTheme.typography.titleLarge,
                )

                val note = when {
                    relation == null -> stringResource(R.string.relation_hint_chart)
                    relation is Relation.Unrecorded ->
                        stringResource(R.string.relation_answer_none_body)

                    answer?.needsBirthYears == true ->
                        stringResource(R.string.relation_birth_years_nudge)

                    else -> null
                }
                note?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
            }

            IconButton(onClick = onClose, modifier = Modifier.testTag(RelationCloseTag)) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = stringResource(R.string.relation_close),
                )
            }
        }

        Row(
            modifier = Modifier.fillMaxWidth().padding(top = 2.dp, bottom = 12.dp, end = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (relation is Relation.Found) {
                Text(
                    text = pluralStringResource(
                        R.plurals.relation_steps,
                        relation.steps,
                        relation.steps,
                    ),
                    style = FTreeText.recordSmall,
                    color = accents.unknown,
                    modifier = Modifier.weight(1f),
                )
                // Only where there is an answer to send: a picture of two people the record does
                // not join is not a thing anybody wants in a family group.
                FilledTonalButton(
                    onClick = onShare,
                    modifier = Modifier.testTag(RelationShareCardTag),
                ) {
                    Icon(Icons.Default.Share, contentDescription = null, Modifier.size(18.dp))
                    Text(
                        text = stringResource(R.string.card_share_short),
                        modifier = Modifier.padding(start = 8.dp),
                    )
                }
            } else {
                Box(Modifier.weight(1f).height(4.dp))
            }
        }
    }
}

/**
 * Who is being compared, as one line rather than two labelled fields.
 *
 * Below the fold on purpose. Once there is an answer the pair is a thing you check or change, not
 * the thing you are reading; before there is one, the sheet opens far enough to show it.
 */
@Composable
private fun Pair(state: RelationUiState, onPick: (RelationSlot) -> Unit, onSwap: () -> Unit) {
    val between = stringResource(R.string.relation_between)
    val and = stringResource(R.string.relation_and)

    /*
     * One column for both words, as wide as the longer of them.
     *
     * "Between" and "and" are not the same length, so setting each card's name straight after its
     * own word put the two people at different distances from the edge — a stagger of a few points
     * that reads as a mistake, because the two rows are plainly meant to be the same shape. The
     * width is measured from the words themselves rather than set to a number, so it survives
     * translation and the reader's text size, both of which change the answer.
     */
    val measurer = rememberTextMeasurer()
    val labelWidth = with(LocalDensity.current) {
        maxOf(
            measurer.measure(between, FTreeText.recordSmall).size.width,
            measurer.measure(and, FTreeText.recordSmall).size.width,
        ).toDp()
    }

    val from: @Composable (Modifier) -> Unit = { modifier ->
        Slot(
            label = between,
            labelWidth = labelWidth,
            person = state.from,
            tag = RelationSlotFromTag,
            modifier = modifier,
            onClick = { onPick(RelationSlot.FROM) },
        )
    }
    val to: @Composable (Modifier) -> Unit = { modifier ->
        Slot(
            label = and,
            labelWidth = labelWidth,
            person = state.to,
            tag = RelationSlotToTag,
            modifier = modifier,
            onClick = { onPick(RelationSlot.TO) },
        )
    }

    Row(
        modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        /*
         * Side by side when the window is short.
         *
         * A phone held sideways has half the height and twice the width, and the fold is taken out
         * of the chart the question is about. The pair is one thought either way round; laid across
         * it costs a line instead of two.
         */
        if (isShortWindow()) {
            Row(
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                from(Modifier.weight(1f))
                to(Modifier.weight(1f))
            }
        } else {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                from(Modifier)
                to(Modifier)
            }
        }
        if (state.bothChosen) {
            IconButton(onClick = onSwap, modifier = Modifier.testTag(RelationSwapTag)) {
                Icon(
                    Icons.Default.SwapVert,
                    contentDescription = stringResource(R.string.relation_swap),
                )
            }
        }
    }
}

/** The face beside a name, and the space kept for it before there is one. */
private val AVATAR = 28.dp

/** One of the two people, or an invitation to choose one. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Slot(
    label: String,
    /** Shared with the other slot, so both names start at the same place. */
    labelWidth: Dp,
    person: Person?,
    tag: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Card(
        onClick = onClick,
        modifier = modifier.fillMaxWidth().testTag(tag),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.45f),
        ),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = label,
                style = FTreeText.recordSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.width(labelWidth),
            )
            Spacer(Modifier.width(12.dp))
            /*
             * The face's place is held whether or not there is a face in it. Drawing it only once
             * somebody is chosen moved the name sideways at the moment of choosing, and left a
             * filled slot and an empty one disagreeing about where a name begins — which is the
             * same misalignment again, from the other direction.
             */
            Box(Modifier.size(AVATAR), contentAlignment = Alignment.Center) {
                person?.let { PersonAvatar(it, diameter = AVATAR, decorative = true) }
            }
            Spacer(Modifier.width(10.dp))
            Text(
                text = person?.displayName() ?: stringResource(R.string.relation_choose),
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                fontStyle = if (person != null && person.isUnnamed) FontStyle.Italic
                else FontStyle.Normal,
                color = if (person == null) MaterialTheme.colorScheme.onSurfaceVariant
                else MaterialTheme.colorScheme.onSurface,
            )
        }
    }
}

/** Searching the whole tree for one of the two. */
@Composable
private fun PersonPicker(
    people: List<Person>,
    query: String,
    onQueryChange: (String) -> Unit,
    onPick: (String) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { focus.requestFocus() }

    Column(modifier.fillMaxHeight()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            OutlinedTextField(
                value = query,
                onValueChange = onQueryChange,
                label = { Text(stringResource(R.string.relation_pick_hint)) },
                singleLine = true,
                modifier = Modifier.weight(1f).focusRequester(focus).testTag(RelationPickSearchTag),
            )
            IconButton(onClick = onCancel) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = stringResource(R.string.relation_close),
                )
            }
        }
        if (people.isEmpty()) {
            Text(
                text = stringResource(R.string.relation_pick_none),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(20.dp),
            )
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxHeight().testTag(RelationPickListTag),
                contentPadding = PaddingValues(bottom = 24.dp),
            ) {
                items(people, key = { it.id }) { person ->
                    PersonRow(person = person, onClick = { onPick(person.id) })
                }
            }
        }
    }
}
