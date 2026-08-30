package com.vibethroughcode.ftree.ui.transfer

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.PartialDate
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.transfer.ImportPlan
import com.vibethroughcode.ftree.transfer.PersonMatch
import com.vibethroughcode.ftree.transfer.PersonRecord
import com.vibethroughcode.ftree.ui.theme.FTreeText

const val ImportConfirmTag = "import-confirm"
const val ImportCancelTag = "import-cancel"

fun importDecisionTag(importedId: String) = "import-decision-$importedId"

/**
 * What an import would do, before it does anything.
 *
 * The screen leads with what is certain and reassuring — how much is being added, and that nothing
 * is removed or overwritten — and then asks only about the cases the app genuinely cannot settle.
 * Each of those shows its reasoning rather than a verdict, because the user is the only one who
 * actually knows whether two people with the same name are the same person.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ImportReviewScreen(
    plan: ImportPlan,
    decisions: Map<String, Boolean>,
    localPeople: Map<String, Person>,
    onDecision: (String, Boolean) -> Unit,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val reviewable = plan.reviewable
    val adding = plan.peopleAddedUnder(decisions)
    val merging = plan.peopleMergedUnder(decisions)

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.import_title)) },
                navigationIcon = {
                    IconButton(onClick = onCancel, modifier = Modifier.testTag(ImportCancelTag)) {
                        Icon(
                            Icons.Default.Close,
                            contentDescription = stringResource(R.string.import_cancel),
                        )
                    }
                },
            )
        },
    ) { padding ->
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        text = stringResource(
                            R.string.import_summary,
                            plan.document.people.size,
                            plan.document.relationships.size,
                        ),
                        style = MaterialTheme.typography.bodyLarge,
                    )
                    Text(
                        text = stringResource(R.string.import_adds, adding),
                        style = FTreeText.record,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (merging > 0) {
                        Text(
                            text = stringResource(R.string.import_merges, merging),
                            style = FTreeText.record,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (plan.certainMatches > 0) {
                        Text(
                            text = stringResource(R.string.import_recognised, plan.certainMatches),
                            style = FTreeText.record,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Text(
                        text = stringResource(R.string.import_reassurance),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }

            if (reviewable.isNotEmpty()) {
                item {
                    Column(modifier = Modifier.padding(top = 12.dp)) {
                        Text(
                            text = stringResource(R.string.import_review_title),
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(
                            text = stringResource(R.string.import_review_body),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                items(reviewable, key = { it.importedId }) { match ->
                    val incoming = plan.document.people.first { it.id == match.importedId }
                    val existing = match.localId?.let { localPeople[it] }
                    DuplicateCard(
                        match = match,
                        incoming = incoming,
                        existing = existing,
                        merge = decisions[match.importedId] == true,
                        onDecision = { onDecision(match.importedId, it) },
                    )
                }
            }

            item {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    TextButton(onClick = onCancel, modifier = Modifier.weight(1f)) {
                        Text(stringResource(R.string.import_cancel))
                    }
                    Button(
                        onClick = onConfirm,
                        modifier = Modifier.weight(1f).testTag(ImportConfirmTag),
                    ) {
                        Text(stringResource(R.string.import_confirm))
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DuplicateCard(
    match: PersonMatch,
    incoming: PersonRecord,
    existing: Person?,
    merge: Boolean,
    onDecision: (Boolean) -> Unit,
) {
    Card(colors = CardDefaults.cardColors(MaterialTheme.colorScheme.surfaceContainerLow)) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Candidate(
                    label = stringResource(R.string.import_local_label),
                    name = existing?.name,
                    detail = existing?.let { lifeLine(it.birthDate, it.deathDate) },
                    modifier = Modifier.weight(1f),
                )
                Candidate(
                    label = stringResource(R.string.import_incoming_label),
                    name = incoming.name,
                    detail = lifeLine(incoming.birthDate, incoming.deathDate),
                    modifier = Modifier.weight(1f),
                )
            }

            Text(
                text = evidenceLine(match),
                style = FTreeText.recordSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            SingleChoiceSegmentedButtonRow(
                modifier = Modifier.fillMaxWidth().testTag(importDecisionTag(match.importedId)),
            ) {
                SegmentedButton(
                    selected = !merge,
                    onClick = { onDecision(false) },
                    shape = SegmentedButtonDefaults.itemShape(0, 2),
                ) {
                    Text(stringResource(R.string.import_keep_separate))
                }
                SegmentedButton(
                    selected = merge,
                    onClick = { onDecision(true) },
                    shape = SegmentedButtonDefaults.itemShape(1, 2),
                ) {
                    Text(stringResource(R.string.import_same_person))
                }
            }
        }
    }
}

@Composable
private fun Candidate(
    label: String,
    name: String?,
    detail: String?,
    modifier: Modifier = Modifier,
) {
    Column(modifier = modifier, verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(
            text = label.uppercase(),
            style = FTreeText.sectionLabel,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = name ?: stringResource(R.string.person_unknown),
            style = MaterialTheme.typography.titleSmall,
            fontStyle = if (name == null) FontStyle.Italic else FontStyle.Normal,
        )
        Text(
            text = detail ?: stringResource(R.string.person_no_dates),
            style = FTreeText.recordSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

/** States the reasoning behind a proposal, so the user can judge it rather than trust it. */
@Composable
private fun evidenceLine(match: PersonMatch): String {
    val parts = buildList {
        if (match.evidence.sameName) add(stringResource(R.string.import_evidence_name))
        if (match.evidence.datesAgree) add(stringResource(R.string.import_evidence_dates))
        val shared = match.evidence.sharedRelatives
        if (shared == 1) add(stringResource(R.string.import_evidence_relatives, shared))
        if (shared > 1) add(stringResource(R.string.import_evidence_relatives_many, shared))
    }
    return parts.joinToString(" · ").ifEmpty { stringResource(R.string.import_evidence_name) }
}

private fun lifeLine(birth: String?, death: String?): String? {
    val born = PartialDate.parse(birth)?.year
    val died = PartialDate.parse(death)?.year
    return when {
        born != null && died != null -> "$born–$died"
        born != null -> born.toString()
        died != null -> "–$died"
        else -> null
    }
}
