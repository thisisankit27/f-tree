package com.vibethroughcode.ftree.ui.common

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.ui.theme.FTreeText
import com.vibethroughcode.ftree.ui.theme.FTreeTheme

/**
 * One person in a list.
 *
 * The name is set in the serif and the years in the mono, so a glance separates who someone is
 * from what is recorded about them, and the year column lines up down the list.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PersonRow(
    person: Person,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    supporting: String? = null,
    onLongClick: (() -> Unit)? = null,
) {
    val accents = FTreeTheme.accents
    Row(
        modifier = modifier
            .fillMaxWidth()
            .combinedClickable(onClick = onClick, onLongClick = onLongClick)
            // Comfortably above the 48dp minimum touch target, even at a single line.
            .defaultMinSize(minHeight = 64.dp)
            .padding(horizontal = 20.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        PersonAvatar(person)

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = person.displayName(),
                style = MaterialTheme.typography.titleMedium,
                fontStyle = if (person.isUnnamed) FontStyle.Italic else FontStyle.Normal,
                color = if (person.isUnnamed) accents.unknown else MaterialTheme.colorScheme.onSurface,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (supporting != null) {
                Text(
                    text = supporting,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        person.lifespanLabel()?.let { years ->
            Text(
                text = years,
                style = FTreeText.record,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
            )
        }
    }
}
