package com.vibethroughcode.ftree.ui.person

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.text.KeyboardOptions
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.Gender
import com.vibethroughcode.ftree.ui.FTreeViewModels
import com.vibethroughcode.ftree.ui.theme.FTreeText

const val EditNameFieldTag = "edit-name"
const val EditBornFieldTag = "edit-born"
const val EditDiedFieldTag = "edit-died"
const val EditNotesFieldTag = "edit-notes"
const val EditSaveTag = "edit-save"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PersonEditScreen(
    onBack: () -> Unit,
    onSaved: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PersonEditViewModel = viewModel(factory = FTreeViewModels.Factory),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var confirmingDiscard by remember { mutableStateOf(false) }

    fun attemptBack() {
        if (state.dirty) confirmingDiscard = true else onBack()
    }

    BackHandler(enabled = state.dirty) { confirmingDiscard = true }

    Scaffold(
        modifier = modifier,
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        stringResource(
                            if (state.isNew) R.string.edit_new_title else R.string.edit_existing_title
                        )
                    )
                },
                navigationIcon = {
                    IconButton(onClick = ::attemptBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.edit_back),
                        )
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .imePadding()
                .padding(horizontal = 20.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Spacer(Modifier.height(4.dp))

            OutlinedTextField(
                value = state.name,
                onValueChange = viewModel::onNameChange,
                label = { Text(stringResource(R.string.edit_name)) },
                supportingText = { Text(stringResource(R.string.edit_name_hint)) },
                singleLine = true,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words),
                modifier = Modifier.fillMaxWidth().testTag(EditNameFieldTag),
            )

            GenderChips(selected = state.gender, onSelect = viewModel::onGenderChange)

            DateField(
                value = state.birthDate,
                onValueChange = viewModel::onBirthDateChange,
                label = stringResource(R.string.edit_born),
                problem = state.birthProblem,
                tag = EditBornFieldTag,
            )

            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = stringResource(R.string.edit_deceased),
                    style = MaterialTheme.typography.bodyLarge,
                )
                Switch(checked = state.deceased, onCheckedChange = viewModel::onDeceasedChange)
            }

            if (state.deceased) {
                DateField(
                    value = state.deathDate,
                    onValueChange = viewModel::onDeathDateChange,
                    label = stringResource(R.string.edit_died),
                    problem = state.deathProblem,
                    tag = EditDiedFieldTag,
                )
            }

            OutlinedTextField(
                value = state.notes,
                onValueChange = viewModel::onNotesChange,
                label = { Text(stringResource(R.string.edit_notes)) },
                placeholder = { Text(stringResource(R.string.edit_notes_hint)) },
                minLines = 3,
                keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                modifier = Modifier.fillMaxWidth().testTag(EditNotesFieldTag),
            )

            Button(
                onClick = { viewModel.save(onSaved) },
                enabled = state.canSave,
                modifier = Modifier.fillMaxWidth().testTag(EditSaveTag),
            ) {
                Text(stringResource(R.string.edit_save))
            }

            Spacer(Modifier.height(32.dp))
        }
    }

    if (confirmingDiscard) {
        AlertDialog(
            onDismissRequest = { confirmingDiscard = false },
            title = { Text(stringResource(R.string.edit_discard_title)) },
            text = { Text(stringResource(R.string.edit_discard_body)) },
            confirmButton = {
                TextButton(onClick = { confirmingDiscard = false; onBack() }) {
                    Text(stringResource(R.string.edit_discard_confirm))
                }
            },
            dismissButton = {
                TextButton(onClick = { confirmingDiscard = false }) {
                    Text(stringResource(R.string.edit_discard_keep))
                }
            },
        )
    }
}

@Composable
private fun DateField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    problem: DateProblem?,
    tag: String,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        placeholder = { Text(stringResource(R.string.edit_date_hint)) },
        isError = problem != null,
        singleLine = true,
        textStyle = FTreeText.record,
        supportingText = {
            Text(
                when (problem) {
                    DateProblem.MALFORMED -> stringResource(R.string.edit_date_invalid)
                    DateProblem.DEATH_BEFORE_BIRTH -> stringResource(R.string.edit_death_before_birth)
                    null -> stringResource(R.string.edit_date_support)
                }
            )
        },
        modifier = Modifier.fillMaxWidth().testTag(tag),
    )
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun GenderChips(selected: Gender, onSelect: (Gender) -> Unit) {
    val labels = mapOf(
        Gender.MALE to R.string.gender_male,
        Gender.FEMALE to R.string.gender_female,
        Gender.OTHER to R.string.gender_other,
        Gender.UNSPECIFIED to R.string.gender_unspecified,
    )
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            text = stringResource(R.string.edit_gender),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        // Wraps, because four chips plus a large font scale will not fit one line on a phone.
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            labels.forEach { (gender, label) ->
                FilterChip(
                    selected = selected == gender,
                    onClick = { onSelect(gender) },
                    label = { Text(stringResource(label)) },
                )
            }
        }
    }
}
