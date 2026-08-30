package com.vibethroughcode.ftree.ui.person

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.PartialDate
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.ui.FTreeViewModels
import com.vibethroughcode.ftree.ui.common.PersonAvatar
import com.vibethroughcode.ftree.ui.common.SectionRule
import com.vibethroughcode.ftree.ui.common.displayName
import com.vibethroughcode.ftree.ui.theme.FTreeText
import com.vibethroughcode.ftree.ui.theme.FTreeTheme

const val PersonNameTag = "person-name"
const val PersonDeleteTag = "person-delete"
const val PersonEditTag = "person-edit"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PersonDetailScreen(
    onBack: () -> Unit,
    onEdit: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PersonDetailViewModel = viewModel(factory = FTreeViewModels.Factory),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var confirmingDelete by remember { mutableStateOf(false) }

    // A person can disappear underneath this screen — deleted here, or removed by an import — so
    // leaving is driven by the data rather than assumed at the moment of the tap.
    LaunchedEffect(state.loaded, state.person) {
        if (state.loaded && state.person == null) onBack()
    }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = {},
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.edit_back),
                        )
                    }
                },
                actions = {
                    IconButton(
                        onClick = { onEdit(viewModel.personId) },
                        modifier = Modifier.testTag(PersonEditTag),
                    ) {
                        Icon(Icons.Default.Edit, contentDescription = stringResource(R.string.person_edit))
                    }
                    IconButton(
                        onClick = { confirmingDelete = true },
                        modifier = Modifier.testTag(PersonDeleteTag),
                    ) {
                        Icon(
                            Icons.Default.DeleteOutline,
                            contentDescription = stringResource(R.string.delete_person),
                        )
                    }
                },
            )
        },
    ) { padding ->
        val person = state.person
        if (person == null) {
            // Either still loading or already gone; the effect above handles the latter.
            return@Scaffold
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 20.dp),
        ) {
            PersonHeader(person)

            if (!person.notes.isNullOrBlank()) {
                SectionRule(stringResource(R.string.person_notes))
                Text(
                    text = person.notes!!,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp),
                )
            }

            Spacer(Modifier.height(40.dp))
        }
    }

    if (confirmingDelete) {
        DeletePersonDialog(
            name = state.person?.name,
            relationshipCount = state.relationshipCount,
            onDismiss = { confirmingDelete = false },
            onConfirm = { mode ->
                confirmingDelete = false
                viewModel.delete(mode) {}
            },
        )
    }
}

@Composable
private fun PersonHeader(person: Person) {
    val accents = FTreeTheme.accents
    Row(
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        PersonAvatar(person, diameter = 72.dp)
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                text = person.displayName(),
                style = MaterialTheme.typography.headlineMedium,
                fontStyle = if (person.isUnnamed) FontStyle.Italic else FontStyle.Normal,
                color = if (person.isUnnamed) accents.unknown else MaterialTheme.colorScheme.onSurface,
                modifier = Modifier.testTag(PersonNameTag),
            )
            LifeLine(person)
        }
    }
}

/** Dates and age in the mono voice: these are the records, not the person. */
@Composable
private fun LifeLine(person: Person) {
    val born = PartialDate.parse(person.birthDate)
    val died = PartialDate.parse(person.deathDate)
    val age = person.age()

    val lines = buildList {
        born?.let { add(stringResource(R.string.person_born, it.display())) }
        died?.let { add(stringResource(R.string.person_died, it.display())) }
        age?.let { add(stringResource(R.string.person_age, it)) }
    }

    if (lines.isEmpty()) {
        Text(
            text = stringResource(R.string.person_no_dates),
            style = FTreeText.record,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    } else {
        lines.forEach {
            Text(
                text = it,
                style = FTreeText.record,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
