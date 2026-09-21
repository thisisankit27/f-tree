package com.vibethroughcode.ftree.ui.common

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.Person

/**
 * Searching a list of people for one of them.
 *
 * Shared by the relation sheet (searching everyone the tree knows) and the book screen's "Whose
 * story" row (searching within the book's current scope) - one search field, one filtered list and
 * one way to cancel, so a fix to how picking somebody works reaches every place that does it. What
 * differs between callers is the list itself and, where a caller wants its own wording, the hint,
 * empty-result text and test tags; everything else is one implementation.
 */
@Composable
fun PersonPicker(
    people: List<Person>,
    query: String,
    onQueryChange: (String) -> Unit,
    onPick: (String) -> Unit,
    onCancel: () -> Unit,
    modifier: Modifier = Modifier,
    hint: String = stringResource(R.string.relation_pick_hint),
    noneFound: String = stringResource(R.string.relation_pick_none),
    cancelDescription: String = stringResource(R.string.relation_close),
    searchTag: String = "person-picker-search",
    listTag: String = "person-picker-list",
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
                label = { Text(hint) },
                singleLine = true,
                modifier = Modifier.weight(1f).focusRequester(focus).testTag(searchTag),
            )
            IconButton(onClick = onCancel) {
                Icon(Icons.Default.Close, contentDescription = cancelDescription)
            }
        }
        if (people.isEmpty()) {
            Text(
                text = noneFound,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(20.dp),
            )
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxHeight().testTag(listTag),
                contentPadding = PaddingValues(bottom = 24.dp),
            ) {
                items(people, key = { it.id }) { person ->
                    PersonRow(person = person, onClick = { onPick(person.id) })
                }
            }
        }
    }
}
