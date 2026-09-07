package com.vibethroughcode.ftree.ui.relation

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.graph.Relation
import com.vibethroughcode.ftree.ui.common.LocalKinshipLanguage
import com.vibethroughcode.ftree.ui.common.PersonAvatar
import com.vibethroughcode.ftree.ui.common.asRelativeKind
import com.vibethroughcode.ftree.ui.common.displayName
import com.vibethroughcode.ftree.ui.common.relativeRoleLabel
import com.vibethroughcode.ftree.ui.theme.FTreeText
import com.vibethroughcode.ftree.ui.theme.FTreeTheme

/**
 * The card's size in its own units. Rendered at three pixels to the point, so the image is always
 * 1080 x 1350 whatever the phone it was made on — the shape a chat app expects, and the same file
 * from every device.
 */
val CARD_WIDTH = 360.dp
val CARD_HEIGHT = 450.dp

/** The smallest a row can be and still carry a name over the step that makes it. */
private val MIN_ROW = 40.dp

/** And the largest, so a two-person answer sits together rather than drifting apart. */
private val MAX_ROW = 64.dp

private val ROW_GAP = 2.dp

/** The fewest rows that can still tell the truth: both ends, and the note between them. */
private const val MIN_SEATS = 3

/** Past this many characters the sentence is set smaller, so it cannot eat the drawing. */
private const val LONG_SENTENCE = 58

/**
 * A relationship, as something you can send.
 *
 * The app answers "how are we related" in two registers — the sentence and the line it was worked
 * out along — and the card keeps both, because the sentence alone is a claim and the line is what
 * makes it checkable by somebody who knows the family. What it does not do is screenshot the app:
 * a screenshot carries a status bar, a navigation bar and whatever the reader's font size happens
 * to be, and none of that is the answer.
 *
 * Nothing is invented for the picture. It is the same sentence [answerSentence] writes on the
 * screen, in the same vocabulary the reader has chosen, using the app's own notation for a face and
 * a connecting line — so what arrives in somebody's chat is recognisably the thing they were shown.
 */
@Composable
fun RelationCard(
    state: RelationUiState,
    relation: Relation.Found,
    modifier: Modifier = Modifier,
) {
    val accents = FTreeTheme.accents
    val answer = answerSentence(state, relation)
    val from = state.from ?: return

    /*
     * An opaque ground under a rounded card, rather than a rounded card on nothing.
     *
     * A PNG with transparent corners is at the mercy of whatever it lands on: some chat apps
     * composite it onto black and the card grows four dark ears. Painting the whole frame means the
     * picture is the same everywhere, and gives the card an edge to sit on.
     */
    Box(
        modifier = modifier
            .size(CARD_WIDTH, CARD_HEIGHT)
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .padding(14.dp),
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .clip(RoundedCornerShape(18.dp))
                .background(MaterialTheme.colorScheme.background)
                .border(1.dp, accents.rule, RoundedCornerShape(18.dp))
                .padding(horizontal = 24.dp, vertical = 20.dp),
        ) {
            Text(
                text = stringResource(R.string.app_name).uppercase(),
                style = FTreeText.sectionLabel,
                color = accents.unknown,
            )

            Spacer(Modifier.height(14.dp))

            /*
             * The sentence is the headline, but it is not allowed to be the whole card. A short
             * answer is set large because it can be; a long one — a Hindi term with its gloss, two
             * long names — steps down a size rather than pushing the people it is about off the
             * bottom.
             */
            val sentence = answer?.sentence ?: stringResource(
                R.string.card_connected,
                from.displayName(),
                state.to?.displayName().orEmpty(),
            )
            val long = sentence.length > LONG_SENTENCE
            Text(
                text = sentence,
                style = MaterialTheme.typography.headlineSmall.copy(
                    fontSize = if (long) 19.sp else 23.sp,
                    lineHeight = if (long) 25.sp else 30.sp,
                ),
                color = MaterialTheme.colorScheme.onSurface,
                maxLines = 4,
                overflow = TextOverflow.Ellipsis,
            )

            Spacer(Modifier.height(8.dp))

            Text(
                text = stringResource(R.string.card_steps, relation.steps),
                style = FTreeText.recordSmall,
                color = accents.unknown,
            )

            Spacer(Modifier.height(14.dp))
            HorizontalDivider(color = accents.rule)

            Box(modifier = Modifier.fillMaxWidth().weight(1f)) {
                val people = listOf(from) + state.chain.map { it.person }
                val roles = listOf<String?>(null) + state.chain.map { link ->
                    stringResource(
                        relativeRoleLabel(
                            link.kind.asRelativeKind(),
                            link.person.gender,
                            LocalKinshipLanguage.current,
                        )
                    )
                }
                ListBody(people, roles)
            }

            HorizontalDivider(color = accents.rule)
            Spacer(Modifier.height(8.dp))
            Text(
                text = stringResource(R.string.card_footer),
                style = FTreeText.recordSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * The line as a register: one person to a row, each saying what they are to the one above.
 *
 * How many rows there are is decided by the room left over, not by a constant. The card is a fixed
 * size and the sentence above it is not, so the space available here is only known once that
 * sentence has been set; assuming a number of rows is how the last person ends up squeezed into the
 * footer. Instead: as many people as fit at a height a name can be read at, and the rest counted.
 */
@Composable
private fun ListBody(people: List<Person>, roles: List<String?>) {
    val accents = FTreeTheme.accents
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val seats = ((maxHeight + ROW_GAP) / (MIN_ROW + ROW_GAP)).toInt().coerceAtLeast(MIN_SEATS)
        val shown = seat(people, roles, seats)
        val row = ((maxHeight - ROW_GAP * (shown.size - 1)) / shown.size).coerceIn(MIN_ROW, MAX_ROW)
        val face = (row - 14.dp).coerceIn(24.dp, 32.dp)

        Column(
            modifier = Modifier.fillMaxSize(),
            verticalArrangement = Arrangement.spacedBy(ROW_GAP, Alignment.CenterVertically),
        ) {
            shown.forEachIndexed { index, seat ->
                Row(
                    modifier = Modifier.fillMaxWidth().height(row),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    /*
                     * A rail through the faces, joining one row to the next.
                     *
                     * Without it this is a list of people who happen to be near each other. The line
                     * is what says they are a route, which is the whole difference between this card
                     * and a screenshot of a contacts app. The gutter keeps one width whatever size
                     * the faces take, so the names stay in a column.
                     */
                    Box(
                        modifier = Modifier.size(32.dp, row),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (index > 0) {
                            Box(
                                Modifier
                                    .width(1.dp)
                                    .height(row / 2)
                                    .align(Alignment.TopCenter)
                                    .background(accents.rule)
                            )
                        }
                        if (index < shown.lastIndex) {
                            Box(
                                Modifier
                                    .width(1.dp)
                                    .height(row / 2)
                                    .align(Alignment.BottomCenter)
                                    .background(accents.rule)
                            )
                        }
                        when (val person = seat.person) {
                            null -> Box(
                                Modifier
                                    .size(7.dp)
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(accents.unknown)
                            )

                            else -> PersonAvatar(person, diameter = face, decorative = true)
                        }
                    }

                    Column(Modifier.weight(1f)) {
                        when (val person = seat.person) {
                            null -> Text(
                                text = stringResource(R.string.card_more, seat.skipped),
                                style = FTreeText.recordSmall,
                                color = accents.unknown,
                            )

                            else -> {
                                Name(person, style = MaterialTheme.typography.titleSmall)
                                seat.role?.let {
                                    Text(
                                        text = it,
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Name(person: Person, style: androidx.compose.ui.text.TextStyle) {
    val accents = FTreeTheme.accents
    Text(
        text = person.displayName(),
        style = style,
        fontStyle = if (person.isUnnamed) FontStyle.Italic else FontStyle.Normal,
        color = if (person.isUnnamed) accents.unknown else MaterialTheme.colorScheme.onSurface,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        textAlign = TextAlign.Start,
    )
}

/** A place on the card: somebody, or the note standing in for the people who did not fit. */
private data class Seat(val person: Person?, val role: String?, val skipped: Int = 0)

/**
 * Fits a line of any length into the rows there is room for.
 *
 * A card that grew with the family would be a different picture every time and a poor one for a
 * long line. So both ends are always shown — they are the two people the question was about — and
 * where the middle does not fit it is counted rather than cut, because "and four more" is true and
 * a silently shortened chain is not.
 */
private fun seat(people: List<Person>, roles: List<String?>, seats: Int): List<Seat> {
    if (people.size <= seats) {
        return people.mapIndexed { index, person -> Seat(person, roles.getOrNull(index)) }
    }
    val head = seats / 2
    val tail = seats - head - 1
    return buildList {
        repeat(head) { add(Seat(people[it], roles.getOrNull(it))) }
        add(Seat(null, null, skipped = people.size - head - tail))
        for (i in people.size - tail until people.size) add(Seat(people[i], roles.getOrNull(i)))
    }
}
