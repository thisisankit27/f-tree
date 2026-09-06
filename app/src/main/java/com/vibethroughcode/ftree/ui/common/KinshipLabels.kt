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
 * The word for a relationship, or null where English simply has none.
 *
 * Null is a real answer and not a failure. English names blood relationships all the way out to
 * "second cousin twice removed", and marriage relationships only for the nearest few — an uncle's
 * wife is an aunt, but a first cousin's wife is just a first cousin's wife. Returning null there
 * is what lets the screen say who somebody married instead of reaching for a word nobody uses.
 *
 * These are deliberately a separate set from the `role_*` labels beside a name on a person's page.
 * Those are headings — "Father" — while these are read inside a sentence, and lower-casing a
 * heading in code would be wrong the moment the app is read in a language that capitalises its
 * nouns. Gender only ever narrows the word, and falls back to the neutral one when it is not
 * recorded, so the term is never a guess.
 */
@Composable
fun kinshipLabel(term: KinshipTerm, gender: Gender): String? = when (term) {
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

    KinshipTerm.Spouse -> byGender(gender, R.string.kin_husband, R.string.kin_wife, R.string.kin_spouse)

    // A marriage-relation English happens to have a word for; null when it does not, and the
    // screen then says who they married in a sentence instead of inventing one.
    is KinshipTerm.SpouseOf -> inLawLabel(term, gender)
    is KinshipTerm.OfSpouse -> inLawLabel(term, gender)
}

/**
 * The single word for a relationship through one marriage, where English has one.
 *
 * It has a word for the close ones and nothing at all past them — an uncle's wife is an aunt, a
 * first cousin's wife is a first cousin's wife. Returning null for those is the point: it is what
 * tells the screen to say who somebody married rather than to reach for a word that does not exist.
 */
@Composable
fun inLawLabel(term: KinshipTerm, gender: Gender): String? = when (term) {
    // Married to one of the subject's blood relatives.
    is KinshipTerm.SpouseOf -> when (val relative = term.relative) {
        // A parent's sibling's spouse is simply an aunt or an uncle, and always has been.
        is KinshipTerm.ParentsSibling -> greats(relative.greats) +
            byGender(gender, R.string.kin_uncle, R.string.kin_aunt, R.string.kin_aunt_or_uncle)

        KinshipTerm.Sibling ->
            byGender(gender, R.string.kin_brother_in_law, R.string.kin_sister_in_law, R.string.kin_sibling_in_law)

        is KinshipTerm.Ancestor -> if (relative.generations == 1) {
            byGender(gender, R.string.kin_stepfather, R.string.kin_stepmother, R.string.kin_stepparent)
        } else null

        is KinshipTerm.Descendant -> if (relative.generations == 1) {
            byGender(gender, R.string.kin_son_in_law, R.string.kin_daughter_in_law, R.string.kin_child_in_law)
        } else null

        else -> null
    }

    // A blood relative of the subject's own spouse.
    is KinshipTerm.OfSpouse -> when (val relative = term.relative) {
        is KinshipTerm.Ancestor -> if (relative.generations == 1) {
            byGender(gender, R.string.kin_father_in_law, R.string.kin_mother_in_law, R.string.kin_parent_in_law)
        } else null

        KinshipTerm.Sibling ->
            byGender(gender, R.string.kin_brother_in_law, R.string.kin_sister_in_law, R.string.kin_sibling_in_law)

        is KinshipTerm.Descendant -> if (relative.generations == 1) {
            byGender(gender, R.string.kin_stepson, R.string.kin_stepdaughter, R.string.kin_stepchild)
        } else null

        else -> null
    }

    else -> null
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
