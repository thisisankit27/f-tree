package com.vibethroughcode.ftree.ui.common

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.Gender
import com.vibethroughcode.ftree.data.RelativeKind

/**
 * How a relationship is named to the reader.
 *
 * The graph stores one PARENT edge; a person reads "Father". Gender is only ever used to pick the
 * more specific word, and falls back to the neutral one whenever it is not recorded — the label is
 * never a guess.
 */
@StringRes
fun relativeRoleLabel(kind: RelativeKind, gender: Gender): Int = when (kind) {
    RelativeKind.PARENT -> when (gender) {
        Gender.MALE -> R.string.role_father
        Gender.FEMALE -> R.string.role_mother
        else -> R.string.role_parent
    }

    RelativeKind.SPOUSE -> when (gender) {
        Gender.MALE -> R.string.role_husband
        Gender.FEMALE -> R.string.role_wife
        else -> R.string.role_spouse
    }

    RelativeKind.CHILD -> when (gender) {
        Gender.MALE -> R.string.role_son
        Gender.FEMALE -> R.string.role_daughter
        else -> R.string.role_child
    }

    RelativeKind.SIBLING -> when (gender) {
        Gender.MALE -> R.string.role_brother
        Gender.FEMALE -> R.string.role_sister
        else -> R.string.role_sibling
    }
}

/**
 * The heading for a group of relatives.
 *
 * Spouse is the one header whose word depends on the count — someone may have had several over a
 * lifetime — so it resolves through a plural rather than a fixed string.
 */
@Composable
fun sectionTitle(kind: RelativeKind, count: Int): String = when (kind) {
    RelativeKind.PARENT -> stringResource(R.string.section_parents)
    RelativeKind.SPOUSE -> pluralStringResource(R.plurals.section_spouses, count.coerceAtLeast(1))
    RelativeKind.CHILD -> stringResource(R.string.section_children)
    RelativeKind.SIBLING -> stringResource(R.string.section_siblings)
}

@StringRes
fun addRelativeLabel(kind: RelativeKind): Int = when (kind) {
    RelativeKind.PARENT -> R.string.add_parent
    RelativeKind.SPOUSE -> R.string.add_spouse
    RelativeKind.CHILD -> R.string.add_child
    RelativeKind.SIBLING -> R.string.add_sibling
}

@StringRes
fun addRelativeTitle(kind: RelativeKind): Int = when (kind) {
    RelativeKind.PARENT -> R.string.add_relative_title_parent
    RelativeKind.SPOUSE -> R.string.add_relative_title_spouse
    RelativeKind.CHILD -> R.string.add_relative_title_child
    RelativeKind.SIBLING -> R.string.add_relative_title_sibling
}

@StringRes
fun rejectionMessage(reason: com.vibethroughcode.ftree.graph.RelationshipRejection): Int = when (reason) {
    com.vibethroughcode.ftree.graph.RelationshipRejection.SELF_REFERENCE -> R.string.rejected_self
    com.vibethroughcode.ftree.graph.RelationshipRejection.DUPLICATE -> R.string.rejected_duplicate
    com.vibethroughcode.ftree.graph.RelationshipRejection.ANCESTOR_CYCLE -> R.string.rejected_cycle
    com.vibethroughcode.ftree.graph.RelationshipRejection.CONTRADICTS_EXISTING -> R.string.rejected_contradiction
}
