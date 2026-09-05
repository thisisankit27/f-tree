package com.vibethroughcode.ftree.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringArrayResource
import androidx.compose.ui.res.stringResource
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.Gender
import com.vibethroughcode.ftree.data.RelativeKind
import com.vibethroughcode.ftree.graph.KinshipTerm
import com.vibethroughcode.ftree.graph.StepKind

/**
 * The word for a blood relationship.
 *
 * These are deliberately a separate set from the `role_*` labels beside a name on a person's page.
 * Those are headings — "Father" — while these are read inside a sentence, and lower-casing a
 * heading in code would be wrong the moment the app is read in a language that capitalises its
 * nouns. Gender only ever narrows the word, and falls back to the neutral one when it is not
 * recorded, so the term is never a guess.
 */
@Composable
fun kinshipLabel(term: KinshipTerm, gender: Gender): String = when (term) {
    KinshipTerm.Self -> stringResource(R.string.kin_self)

    KinshipTerm.Sibling -> byGender(gender, R.string.kin_brother, R.string.kin_sister, R.string.kin_sibling)

    is KinshipTerm.Ancestor ->
        if (term.generations <= 1) {
            byGender(gender, R.string.kin_father, R.string.kin_mother, R.string.kin_parent)
        } else {
            greats(term.generations - 2) +
                byGender(gender, R.string.kin_grandfather, R.string.kin_grandmother, R.string.kin_grandparent)
        }

    is KinshipTerm.Descendant ->
        if (term.generations <= 1) {
            byGender(gender, R.string.kin_son, R.string.kin_daughter, R.string.kin_child)
        } else {
            greats(term.generations - 2) +
                byGender(gender, R.string.kin_grandson, R.string.kin_granddaughter, R.string.kin_grandchild)
        }

    is KinshipTerm.ParentsSibling -> greats(term.greats) +
        byGender(gender, R.string.kin_uncle, R.string.kin_aunt, R.string.kin_aunt_or_uncle)

    is KinshipTerm.SiblingsChild -> greats(term.greats) +
        byGender(gender, R.string.kin_nephew, R.string.kin_niece, R.string.kin_niece_or_nephew)

    is KinshipTerm.Cousin -> {
        val base = stringResource(R.string.kin_cousin, ordinal(term.degree))
        when (term.removed) {
            0 -> base
            1 -> stringResource(R.string.kin_cousin_removed_once, base)
            2 -> stringResource(R.string.kin_cousin_removed_twice, base)
            else -> stringResource(R.string.kin_cousin_removed_many, base, term.removed)
        }
    }
}

@Composable
private fun byGender(gender: Gender, male: Int, female: Int, neutral: Int): String =
    stringResource(
        when (gender) {
            Gender.MALE -> male
            Gender.FEMALE -> female
            else -> neutral
        }
    )

/** "great-great-" and so on. A generation is one repeat, which is exactly how it is said. */
@Composable
private fun greats(count: Int): String =
    stringResource(R.string.kin_great_prefix).repeat(count.coerceAtLeast(0))

/**
 * "first", "second", … The words run out long before the cousins do, so past the list it falls
 * back to a numeral rather than inventing a word nobody says.
 */
@Composable
private fun ordinal(n: Int): String {
    val words = stringArrayResource(R.array.kin_ordinals)
    return if (n in 1..words.size) words[n - 1] else stringResource(R.string.kin_ordinal_nth, n)
}

/**
 * A step along a chain, named the way the rest of the app names a relationship.
 *
 * The graph says "I walked a PARENT edge"; a reader reads "Father". The two enums stay separate
 * for the same reason [com.vibethroughcode.ftree.data.RelativeKind] and `RelationshipType` do —
 * one is how the tree is stored, the other how a family is spoken about.
 */
fun StepKind.asRelativeKind(): RelativeKind = when (this) {
    StepKind.PARENT -> RelativeKind.PARENT
    StepKind.CHILD -> RelativeKind.CHILD
    StepKind.SPOUSE -> RelativeKind.SPOUSE
    StepKind.SIBLING -> RelativeKind.SIBLING
}
