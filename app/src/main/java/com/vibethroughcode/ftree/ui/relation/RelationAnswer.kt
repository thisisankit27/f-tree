package com.vibethroughcode.ftree.ui.relation

import android.content.Intent
import android.widget.Toast
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.graph.KinshipTerm
import com.vibethroughcode.ftree.graph.Relation
import com.vibethroughcode.ftree.transfer.sendCardIntent
import com.vibethroughcode.ftree.ui.common.kinshipLabel
import com.vibethroughcode.ftree.ui.common.kinshipName
import com.vibethroughcode.ftree.ui.common.displayName
import kotlinx.coroutines.launch

const val RelationSlotFromTag = "relation-slot-from"
const val RelationSlotToTag = "relation-slot-to"
const val RelationSwapTag = "relation-swap"
const val RelationAnswerTag = "relation-answer"
const val RelationChainTag = "relation-chain"
const val RelationPickListTag = "relation-pick-list"
const val RelationPickSearchTag = "relation-pick-search"
const val RelationShareCardTag = "relation-share-card"

/**
 * Making the picture and handing it over.
 *
 * Kept here rather than in a view model because it is one screen's business and the whole of it is
 * Android: a bitmap, a file, an intent. The chooser opens on the file being written, so nothing is
 * left in the cache that was never sent anywhere.
 */
@Composable
fun ShareCard(
    state: RelationUiState,
    relation: Relation.Found,
    onDismiss: () -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val app = context.applicationContext as FTreeApplication
    val failed = stringResource(R.string.card_failed)

    ShareRelationDialog(
        state = state,
        relation = relation,
        onDismiss = onDismiss,
        onSend = { picture ->
            scope.launch {
                runCatching {
                    val uri = app.container.cardShare.write(picture.image.asAndroidBitmap(), picture.name)
                    context.startActivity(
                        Intent.createChooser(sendCardIntent(uri, picture.caption), null)
                    )
                }.onFailure {
                    Toast.makeText(context, failed, Toast.LENGTH_LONG).show()
                }
                onDismiss()
            }
        },
    )
}

/** The answer, and whether a birth year would sharpen it. */
internal data class Answer(val sentence: String, val needsBirthYears: Boolean = false)

/**
 * How the relationship reads as a sentence, or nothing when the record cannot say.
 *
 * Three shapes, because a relationship through a marriage is not a noun the way a blood one is.
 * "Priya is Ankit's first cousin" works; "Madhu is Ankit's first cousin once removed's wife" is a
 * possessive chain nobody says out loud, so that one is turned around into "Madhu is married to
 * Ankit's first cousin once removed" — same fact, said the way a person would say it.
 */
@Composable
internal fun answerSentence(state: RelationUiState, relation: Relation.Found): Answer? {
    val to = state.to ?: return null
    val from = state.from ?: return null
    val term = relation.term ?: return null
    val toName = to.displayName()
    val fromName = from.displayName()

    /*
     * The chosen vocabulary first, whole. Hindi returns a word plus what it means in English, shown
     * in brackets after it — "मामा (maternal uncle)" — which is how a bilingual family speaks and
     * what lets a younger relative who has not learned the word still read the answer.
     */
    kinshipName(term, relation.path, from.gender, to.gender)?.let { name ->
        val word = name.gloss?.let { stringResource(R.string.kin_with_gloss, name.term, it) }
            ?: name.term
        return Answer(
            sentence = stringResource(R.string.relation_answer_term, toName, fromName, word),
            needsBirthYears = name.needsBirthYears,
        )
    }

    // Past that, the sentence turns round and says who somebody married. Left in English on both
    // settings: these are the shapes no language here has a single word for, so there is nothing
    // to translate — only a phrase, and an English phrase is the one the app already writes well.
    return when (term) {
        // Married to somebody English has a word for, even though the marriage itself is not one.
        is KinshipTerm.SpouseOf -> {
            val married = state.chain.getOrNull(state.chain.lastIndex - 1)?.person ?: return null
            kinshipLabel(term.relative, married.gender)?.let {
                Answer(stringResource(R.string.relation_answer_married_to, toName, fromName, it))
            }
        }

        // A blood relative of the subject's own spouse: named from the spouse's side.
        is KinshipTerm.OfSpouse -> {
            val spouse = state.chain.firstOrNull()?.person ?: return null
            val relative = kinshipLabel(term.relative, to.gender) ?: return null
            val spouseWord = kinshipLabel(KinshipTerm.Spouse, spouse.gender) ?: return null
            Answer(
                stringResource(
                    R.string.relation_answer_of_spouse, toName, fromName, relative, spouseWord,
                )
            )
        }

        else -> null
    }
}
