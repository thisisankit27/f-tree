package com.vibethroughcode.ftree.ui.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.vibethroughcode.ftree.ui.theme.FTreeText
import com.vibethroughcode.ftree.ui.theme.FTreeTheme

/**
 * A ruled heading, in the manner of a paper register: a letterspaced label followed by a hairline
 * that runs to the edge. The rule is the same weight and colour as the connectors in the family
 * chart, so the two screens read as one document.
 */
@Composable
fun SectionRule(
    label: String,
    modifier: Modifier = Modifier,
    trailing: @Composable (() -> Unit)? = null,
) {
    Row(
        modifier = modifier.padding(top = 24.dp, bottom = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = label.uppercase(),
            style = FTreeText.sectionLabel,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.semantics { heading() },
        )
        HorizontalDivider(
            modifier = Modifier.weight(1f),
            thickness = 1.dp,
            color = FTreeTheme.accents.rule,
        )
        trailing?.invoke()
    }
}
