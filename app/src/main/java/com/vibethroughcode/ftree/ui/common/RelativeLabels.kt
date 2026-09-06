package com.vibethroughcode.ftree.ui.common

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.Gender
import com.vibethroughcode.ftree.data.KinshipLanguage
import com.vibethroughcode.ftree.data.RelativeKind

/**
 * The heading beside a relative's name, in the chosen family vocabulary.
 *
 * Hindi uses the same words the relation finder does — पिता, बेटा, भाई — because a reader who has
 * asked for Hindi should not meet "Father" as a heading and मामा in a sentence on the next screen.
 *
 * There is no neuter kinship word in Hindi, so an unrecorded gender falls back to the English
 * heading rather than leaving the row unlabelled.
 */
@StringRes
fun relativeRoleLabel(kind: RelativeKind, gender: Gender, language: KinshipLanguage): Int =
    hindiRoleLabel(kind, gender).takeIf { language == KinshipLanguage.HINDI && it != 0 }
        ?: relativeRoleLabel(kind, gender)

@StringRes
private fun hindiRoleLabel(kind: RelativeKind, gender: Gender): Int = when (kind to gender) {
    RelativeKind.PARENT to Gender.MALE -> R.string.kin_hi_pita
    RelativeKind.PARENT to Gender.FEMALE -> R.string.kin_hi_mata
    RelativeKind.SPOUSE to Gender.MALE -> R.string.kin_hi_pati
    RelativeKind.SPOUSE to Gender.FEMALE -> R.string.kin_hi_patni
    RelativeKind.CHILD to Gender.MALE -> R.string.kin_hi_beta
    RelativeKind.CHILD to Gender.FEMALE -> R.string.kin_hi_beti
    RelativeKind.SIBLING to Gender.MALE -> R.string.kin_hi_bhai
    RelativeKind.SIBLING to Gender.FEMALE -> R.string.kin_hi_behen
    else -> 0
}

/**
 * The English heading, and what every other vocabulary falls back to.
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

/** The bare word for a relationship kind, for use in a chip or a menu. */
@StringRes
fun relativeKindLabel(kind: RelativeKind): Int = when (kind) {
    RelativeKind.PARENT -> R.string.kind_parent
    RelativeKind.SPOUSE -> R.string.kind_spouse
    RelativeKind.CHILD -> R.string.kind_child
    RelativeKind.SIBLING -> R.string.kind_sibling
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
