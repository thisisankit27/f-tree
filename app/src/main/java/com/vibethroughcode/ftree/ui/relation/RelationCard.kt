package com.vibethroughcode.ftree.ui.relation

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
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
import androidx.compose.ui.graphics.Color
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

/** Which drawing of the line between two people the card carries. */
enum class CardStyle { TREE, LIST }

/**
 * The card's size in its own units. Rendered at three pixels to the point, so the image is always
 * 1080 x 1350 whatever the phone it was made on — the shape a chat app expects, and the same file
 * from every device.
 */
val CARD_WIDTH = 360.dp
val CARD_HEIGHT = 450.dp

/** How many people the body can show before it starts summarising. */
private const val TREE_SEATS = 4
private const val LIST_SEATS = 5

/**
 * Every card on the tree is the same width.
 *
 * Boxes sized to their names would step in and out down the page and the connectors would meet them
 * off-centre; one width gives the drawing a spine, which is what makes it read as descent rather
 * than as a list that has been boxed.
 */
private val TREE_CARD_WIDTH = 208.dp

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
 * screen, in the same vocabulary the reader has chosen, using the app's own notation for a card and
 * a connector — so what arrives in somebody's chat is recognisably the thing they were shown.
 */
@Composable
fun RelationCard(
    state: RelationUiState,
    relation: Relation.Found,
    style: CardStyle,
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
            .padding(horizontal = 24.dp, vertical = 22.dp),
    ) {
        Text(
            text = stringResource(R.string.app_name).uppercase(),
            style = FTreeText.sectionLabel,
            color = accents.unknown,
        )

        Spacer(Modifier.height(16.dp))

        Text(
            text = answer?.sentence
                ?: stringResource(
                    R.string.card_connected,
                    from.displayName(),
                    state.to?.displayName().orEmpty(),
                ),
            style = MaterialTheme.typography.headlineSmall.copy(fontSize = 22.sp, lineHeight = 29.sp),
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 4,
            overflow = TextOverflow.Ellipsis,
        )

        Spacer(Modifier.height(10.dp))

        Text(
            text = stringResource(R.string.card_steps, relation.steps),
            style = FTreeText.recordSmall,
            color = accents.unknown,
        )

        Spacer(Modifier.height(16.dp))
        HorizontalDivider(color = accents.rule)

        Box(
            modifier = Modifier.fillMaxWidth().weight(1f),
            contentAlignment = Alignment.Center,
        ) {
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
            when (style) {
                CardStyle.TREE -> TreeBody(people, roles)
                CardStyle.LIST -> ListBody(people, roles)
            }
        }

        HorizontalDivider(color = accents.rule)
        Spacer(Modifier.height(10.dp))
        Text(
            text = stringResource(R.string.card_footer),
            style = FTreeText.recordSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
    }
}

/**
 * The line drawn as a descent: cards down the middle, joined by the app's own connector, with each
 * step named on the rule that makes it.
 *
 * This is the shape somebody recognises as a family tree, which is why it is the one the card
 * offers first.
 */
@Composable
private fun TreeBody(people: List<Person>, roles: List<String?>) {
    val accents = FTreeTheme.accents
    val shown = seat(people, roles, TREE_SEATS)

    Column(
        modifier = Modifier.fillMaxWidth(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        shown.forEachIndexed { index, seat ->
            if (index > 0) {
                Connector(label = seat.role, hidden = seat.person == null)
            }
            when (val person = seat.person) {
                null -> Text(
                    text = stringResource(R.string.card_more, seat.skipped),
                    style = FTreeText.recordSmall,
                    color = accents.unknown,
                )

                else -> Row(
                    modifier = Modifier
                        .width(TREE_CARD_WIDTH)
                        .clip(RoundedCornerShape(12.dp))
                        .background(MaterialTheme.colorScheme.surfaceContainerLow)
                        .border(1.dp, accents.rule, RoundedCornerShape(12.dp))
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                ) {
                    PersonAvatar(person, diameter = 26.dp, decorative = true)
                    Name(person, style = MaterialTheme.typography.titleSmall)
                }
            }
        }
    }
}

/**
 * The rule between two cards, with the step written beside it.
 *
 * The line is centred on the card above and below it and the label hangs off it, rather than the
 * two sharing a row — otherwise the width of the word decides where the spine goes, and a long one
 * bends the whole drawing.
 */
@Composable
private fun Connector(label: String?, hidden: Boolean) {
    val accents = FTreeTheme.accents
    Box(
        modifier = Modifier.width(TREE_CARD_WIDTH).height(26.dp),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .width(1.dp)
                .height(26.dp)
                .background(if (hidden) Color.Transparent else accents.rule)
        )
        label?.let {
            Text(
                text = it,
                style = FTreeText.recordSmall,
                color = accents.unknown,
                modifier = Modifier.align(Alignment.Center).padding(start = 96.dp),
            )
        }
    }
}

/**
 * The same line as a register: one person to a row, each saying what they are to the one above.
 *
 * Plainer than the tree and better for a longer line, where boxes and connectors become a ladder
 * nobody reads.
 */
@Composable
private fun ListBody(people: List<Person>, roles: List<String?>) {
    val accents = FTreeTheme.accents
    val shown = seat(people, roles, LIST_SEATS)

    Column(
        modifier = Modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(2.dp),
    ) {
        shown.forEachIndexed { index, seat ->
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                /*
                 * A rail through the faces, joining one row to the next.
                 *
                 * Without it this is a list of people who happen to be near each other. The line is
                 * what says they are a route, which is the whole difference between this card and a
                 * screenshot of a contacts app.
                 */
                Box(
                    modifier = Modifier.size(32.dp, 46.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    if (index > 0) {
                        Box(
                            Modifier
                                .width(1.dp)
                                .height(23.dp)
                                .align(Alignment.TopCenter)
                                .background(accents.rule)
                        )
                    }
                    if (index < shown.lastIndex) {
                        Box(
                            Modifier
                                .width(1.dp)
                                .height(23.dp)
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

                        else -> PersonAvatar(person, diameter = 32.dp, decorative = true)
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
                                )
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
 * Fits a line of any length into a fixed card.
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
