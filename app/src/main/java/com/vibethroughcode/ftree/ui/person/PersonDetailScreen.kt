package com.vibethroughcode.ftree.ui.person

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CompareArrows
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.vibethroughcode.ftree.data.RelativeKind
import com.vibethroughcode.ftree.ui.FTreeViewModels
import com.vibethroughcode.ftree.ui.common.PersonAvatar
import com.vibethroughcode.ftree.ui.common.SectionRule
import com.vibethroughcode.ftree.ui.common.PersonRow
import com.vibethroughcode.ftree.ui.common.addRelativeLabel
import com.vibethroughcode.ftree.ui.common.displayName
import com.vibethroughcode.ftree.ui.common.READABLE_MEASURE
import com.vibethroughcode.ftree.ui.common.ReadingColumns
import com.vibethroughcode.ftree.ui.common.LocalKinshipLanguage
import com.vibethroughcode.ftree.ui.common.relativeRoleLabel
import com.vibethroughcode.ftree.ui.common.sectionTitle
import com.vibethroughcode.ftree.ui.theme.FTreeText
import com.vibethroughcode.ftree.ui.theme.FTreeTheme
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.draw.clip

const val PersonNameTag = "person-name"
const val PersonDeleteTag = "person-delete"
const val PersonMenuTag = "person-menu"
const val PersonRelateTag = "person-relate"
const val PersonShareTag = "person-share"
const val PersonEditTag = "person-edit"
const val PersonAvatarTag = "person-avatar"

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PersonDetailScreen(
    onBack: () -> Unit,
    onEdit: (String) -> Unit,
    onOpenPerson: (String) -> Unit,
    onAddRelative: (String, RelativeKind) -> Unit,
    onShowOnTree: (String) -> Unit,
    onRelate: (String) -> Unit,
    onShare: (String) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: PersonDetailViewModel = viewModel(factory = FTreeViewModels.Factory),
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    var confirmingDelete by remember { mutableStateOf(false) }
    var menuOpen by remember { mutableStateOf(false) }
    var pendingRemoval by remember { mutableStateOf<Person?>(null) }

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
                    IconButton(onClick = { onShowOnTree(viewModel.personId) }) {
                        Icon(
                            Icons.Default.AccountTree,
                            contentDescription = stringResource(R.string.person_show_on_tree),
                        )
                    }
                    IconButton(
                        onClick = { onEdit(viewModel.personId) },
                        modifier = Modifier.testTag(PersonEditTag),
                    ) {
                        Icon(Icons.Default.Edit, contentDescription = stringResource(R.string.person_edit))
                    }
                    // Delete sits behind the overflow rather than beside edit. Two icons of equal
                    // weight, one of which removes a person from the family, is a mis-tap waiting
                    // to happen.
                    IconButton(
                        onClick = { menuOpen = true },
                        modifier = Modifier.testTag(PersonMenuTag),
                    ) {
                        Icon(
                            Icons.Default.MoreVert,
                            contentDescription = stringResource(R.string.person_more),
                        )
                    }
                    DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                        // Starting from the person whose page this is, because "how am I related
                        // to them" is nearly always asked about somebody already in front of you.
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.relation_open_from_person)) },
                            leadingIcon = {
                                Icon(Icons.Default.CompareArrows, contentDescription = null)
                            },
                            onClick = { menuOpen = false; onRelate(viewModel.personId) },
                            modifier = Modifier.testTag(PersonRelateTag),
                        )
                        /*
                         * Sending one person's family, rather than the whole archive.
                         *
                         * Above delete because it is the one somebody actually comes here to do,
                         * and because the two should not be neighbours a mis-tap apart.
                         */
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.share_branch)) },
                            leadingIcon = {
                                Icon(Icons.Default.Share, contentDescription = null)
                            },
                            onClick = { menuOpen = false; onShare(viewModel.personId) },
                            modifier = Modifier.testTag(PersonShareTag),
                        )
                        DropdownMenuItem(
                            text = { Text(stringResource(R.string.delete_person)) },
                            leadingIcon = {
                                Icon(Icons.Default.DeleteOutline, contentDescription = null)
                            },
                            onClick = { menuOpen = false; confirmingDelete = true },
                            modifier = Modifier.testTag(PersonDeleteTag),
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
                .fillMaxHeight()
                .padding(padding)
                .verticalScroll(rememberScrollState()),
        ) {
            // Who the page is about, across the top of it: one person, so one column, however
            // wide the glass. The sections below are four separate lists and can stand abreast.
            PersonHeader(
                person,
                Modifier.widthIn(max = READABLE_MEASURE).padding(horizontal = 20.dp),
            )

            // No gutter: each section already holds its rows twenty points off its own edges, so
            // two of them side by side keep forty points between the names, which is enough.
            ReadingColumns(gutter = 0.dp) {
                RelativeKind.entries.forEach { kind ->
                    Column {
                        RelativeSection(
                            kind = kind,
                            relatives = state.of(kind),
                            onOpen = onOpenPerson,
                            onAdd = { onAddRelative(viewModel.personId, kind) },
                            onRemove = { other -> pendingRemoval = other },
                        )
                    }
                }

                if (!person.notes.isNullOrBlank()) {
                    Column {
                        SectionRule(
                            label = stringResource(R.string.person_notes),
                            modifier = Modifier.padding(horizontal = 20.dp),
                        )
                        Text(
                            text = person.notes!!,
                            style = MaterialTheme.typography.bodyMedium,
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 20.dp, vertical = 4.dp),
                        )
                    }
                }
            }

            Spacer(Modifier.height(40.dp))
        }
    }

    pendingRemoval?.let { other ->
        val subject = other.displayName()
        val anchor = state.person?.displayName().orEmpty()
        AlertDialog(
            onDismissRequest = { pendingRemoval = null },
            title = { Text(stringResource(R.string.remove_relationship_title)) },
            text = { Text(stringResource(R.string.remove_relationship_body, subject, anchor)) },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.removeRelationshipWith(other.id)
                    pendingRemoval = null
                }) {
                    Text(stringResource(R.string.remove_relationship_confirm))
                }
            },
            dismissButton = {
                TextButton(onClick = { pendingRemoval = null }) {
                    Text(stringResource(R.string.delete_cancel))
                }
            },
        )
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
private fun PersonHeader(person: Person, modifier: Modifier = Modifier) {
    val accents = FTreeTheme.accents
    var showingPhoto by rememberSaveable { mutableStateOf(false) }

    Row(
        modifier = modifier.fillMaxWidth().padding(top = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(20.dp),
    ) {
        /*
         * A photograph opens; an initial does not.
         *
         * Only a face is worth a second look, and making the lettered circle tappable would offer
         * a gesture that leads to a blank screen. The ripple is the whole affordance: nothing here
         * announces itself as a button, because a photograph on a person's page is the one thing a
         * reader already expects to be able to tap.
         */
        val hasPhoto = person.photoId != null
        val viewLabel = stringResource(R.string.photo_view)
        PersonAvatar(
            person = person,
            diameter = 72.dp,
            modifier = if (!hasPhoto) Modifier else Modifier
                .clip(CircleShape)
                .clickable(onClickLabel = viewLabel) { showingPhoto = true }
                .testTag(PersonAvatarTag),
        )
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

    if (showingPhoto) {
        PersonPhotoDialog(person = person, onDismiss = { showingPhoto = false })
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

/**
 * One group of relatives, headed by a ruled label with the add action on the rule itself.
 *
 * A section with nobody in it is still shown, because the empty rule is what tells you the
 * question has been asked — an absent "Parents" heading reads as "not supported", while an empty
 * one reads as "not recorded yet", which is the whole subject of this app.
 */
@Composable
private fun RelativeSection(
    kind: RelativeKind,
    relatives: List<Person>,
    onOpen: (String) -> Unit,
    onAdd: () -> Unit,
    onRemove: (Person) -> Unit,
) {
    SectionRule(
        label = sectionTitle(kind, relatives.size),
        modifier = Modifier.padding(horizontal = 20.dp),
        trailing = {
            IconButton(onClick = onAdd, modifier = Modifier.testTag(addSectionTag(kind))) {
                Icon(
                    Icons.Default.Add,
                    contentDescription = stringResource(addRelativeLabel(kind)),
                )
            }
        },
    )

    if (relatives.isEmpty()) {
        EmptySection(kind = kind, onAdd = onAdd)
    } else {
        relatives.forEach { relative ->
            PersonRow(
                person = relative,
                onClick = { onOpen(relative.id) },
                onLongClick = { onRemove(relative) },
                supporting = stringResource(
                    relativeRoleLabel(kind, relative.gender, LocalKinshipLanguage.current)
                ),
            )
        }
    }
}

/**
 * The row where a relative would be, if one had been recorded.
 *
 * It used to be a line of grey helper text reading "Add a parent" — which is what a reader taps,
 * because it is the thing shaped like a sentence about parents. It did nothing. The only working
 * control was the small plus at the far end of the rule, which is easy to miss and, on the screen a
 * new person lands on the moment they have added themselves, is the whole of the next step.
 *
 * So the words are the button now. It sits at the height and indent of the rows it stands in for,
 * with the plus where the face would be, which keeps the section reading as a list that happens to
 * be empty rather than as a heading with a note under it.
 */
@Composable
private fun EmptySection(kind: RelativeKind, onAdd: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onAdd)
            .defaultMinSize(minHeight = 56.dp)
            .padding(horizontal = 20.dp, vertical = 8.dp)
            .testTag(emptySectionTag(kind)),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
            Icon(
                imageVector = Icons.Default.Add,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(22.dp),
            )
        }
        Text(
            text = stringResource(addRelativeLabel(kind)),
            style = MaterialTheme.typography.titleSmall,
            color = MaterialTheme.colorScheme.primary,
        )
    }
}

fun addSectionTag(kind: RelativeKind): String = "add-relative-" + kind.name.lowercase()

/** The whole-row way into an empty section, as opposed to the plus on its rule. */
fun emptySectionTag(kind: RelativeKind): String = "empty-section-" + kind.name.lowercase()
