package com.vibethroughcode.ftree.ui.tree

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material.icons.filled.PersonAddAlt
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.data.RelativeKind
import com.vibethroughcode.ftree.graph.CompactBand
import com.vibethroughcode.ftree.graph.CompactFamily
import com.vibethroughcode.ftree.graph.CompactMember
import com.vibethroughcode.ftree.graph.TreeMetrics
import com.vibethroughcode.ftree.ui.common.PersonAvatar
import com.vibethroughcode.ftree.ui.common.addRelativeLabel
import com.vibethroughcode.ftree.ui.common.displayName
import com.vibethroughcode.ftree.ui.common.isShortWindow
import com.vibethroughcode.ftree.ui.common.lifespanLabel
import com.vibethroughcode.ftree.ui.theme.FTreeText
import com.vibethroughcode.ftree.ui.theme.FTreeTheme
import kotlin.math.abs

const val CompactFamilyTag = "compact-family"
const val CompactFocusTag = "compact-focus"
const val CompactMoreGenerationsTag = "compact-more-generations"

/** The card for one person in the compact view, addressable in a test by who it is. */
fun compactPersonTag(personId: String) = "compact-person-$personId"

/** The invitation shown where a whole generation is missing. */
fun compactAddTag(kind: RelativeKind) = "compact-add-" + kind.name.lowercase()

/**
 * The family around one person, read rather than drawn.
 *
 * The two charts are pictures: to read a name you pinch, to reach a cousin you pan, and a canvas
 * has nothing in it for a screen reader — which is why the chart describes itself and then points
 * at the people list. But that list is alphabetical and has no family in it at all. This is the
 * view in between, and its whole design follows from being *composed* rather than painted:
 *
 *  - **Nothing needs a gesture.** One vertical scroll, thumb-sized targets, and text that grows
 *    with the reader's setting instead of being scaled down to fit a fixed card.
 *  - **Generations run down the page**, oldest at the top, which is the direction a family tree is
 *    read on paper and the same order the chart draws.
 *  - **A tap moves you.** Touching anybody re-centres the whole view on them. That is the one
 *    interaction, and it needs no undo: every walk is reversible by a single tap in the band it
 *    came from, because if she is now above you, you are now below her.
 *  - **Absence is shown, not hidden.** A generation nobody has recorded still gets its heading and
 *    an invitation, exactly as on a person's page. An empty rule reads as "not written down yet",
 *    which is the subject of this app; a missing one reads as "not supported".
 *
 * It shows precisely the people the focused chart draws — it is built from that chart's own output
 * — so the two can never disagree about who is family.
 */
@Composable
fun CompactFamilyView(
    family: CompactFamily,
    onWalkTo: (String) -> Unit,
    onPersonActions: (Person) -> Unit,
    onAddRelative: (RelativeKind) -> Unit,
    onShowMoreGenerations: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val focus = family.focus ?: return
    val short = isShortWindow()
    val listState = rememberLazyListState()

    /*
     * Walking re-centres the view on somebody who was, a moment ago, a small card halfway down the
     * screen. Left alone the list would stay where it was and the reader would be looking at a
     * generation they did not ask for, so it is moved to frame the new centre.
     *
     * The generation *above* is what it scrolls to, not the centre itself: landing on "parents,
     * then you, then your children" says in one screen where you have arrived, and the way back up
     * is visible rather than merely available.
     */
    val anchor = (if (family.truncated) 1 else 0) +
        if (family.ancestors.isNotEmpty()) family.ancestors.size - 1 else 0
    LaunchedEffect(focus.person.id) { listState.scrollToItem(anchor) }

    LazyColumn(
        state = listState,
        modifier = modifier.fillMaxSize().testTag(CompactFamilyTag),
        contentPadding = PaddingValues(bottom = 96.dp),
    ) {
        if (family.truncated) {
            item("more-above") {
                MoreGenerations(onClick = onShowMoreGenerations)
            }
        }

        family.ancestors.forEach { band ->
            item("band-${band.offset}") {
                GenerationBand(band, short, onWalkTo)
            }
        }

        if (family.band(-1) == null) {
            item("no-parents") {
                MissingGeneration(RelativeKind.PARENT, -1, short, onAddRelative)
            }
        }

        item("focus") {
            FocusBlock(
                focus = focus,
                short = short,
                onWalkTo = onWalkTo,
                onActions = { onPersonActions(focus.person) },
            )
        }

        family.siblings?.let { band ->
            item("band-0") { GenerationBand(band, short, onWalkTo) }
        }

        if (family.band(1) == null) {
            item("no-children") {
                MissingGeneration(RelativeKind.CHILD, 1, short, onAddRelative)
            }
        }

        family.descendants.forEach { band ->
            item("band-${band.offset}") {
                GenerationBand(band, short, onWalkTo)
            }
        }
    }
}

/**
 * The person everything else is measured from.
 *
 * Given the weight of a page heading rather than a slightly larger card, because it is the one
 * fixed point in a view whose entire content changes on a tap: the reader has to be able to see at
 * a glance whose family they are now looking at. Their marriages are drawn inside the same frame
 * with the chart's doubled rule, so a couple reads as a couple here too.
 *
 * Those marriages sit under the name where there is height for them and beside it where there is
 * not. In landscape a stacked centre would take half of what the screen has, and the view whose
 * whole purpose is to fit a family on a screen would be the worst of the three at doing it.
 */
@Composable
private fun FocusBlock(
    focus: CompactMember,
    short: Boolean,
    onWalkTo: (String) -> Unit,
    onActions: () -> Unit,
) {
    val person = focus.person
    val accents = FTreeTheme.accents
    val spoken = spokenName(person)
    val years = person.lifespanLabel(stringResource(R.string.person_late))

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = if (short) 6.dp else 10.dp)
            .clip(RoundedCornerShape(20.dp))
            .background(MaterialTheme.colorScheme.surfaceContainerHigh)
            .border(1.dp, accents.rule, RoundedCornerShape(20.dp)),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clickable(
                    onClickLabel = stringResource(R.string.compact_actions_for, person.displayName()),
                    onClick = onActions,
                )
                .padding(
                    start = 16.dp,
                    end = 8.dp,
                    top = if (short) 8.dp else 14.dp,
                    bottom = if (short) 8.dp else 14.dp,
                )
                // On the row rather than the frame around it: this is the part that merges the
                // name and the dates into one thing to read, and the part that is tapped.
                .semantics(mergeDescendants = true) { contentDescription = spoken }
                .testTag(CompactFocusTag),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(if (short) 12.dp else 16.dp),
        ) {
            PersonAvatar(
                person,
                diameter = if (short) 44.dp else 64.dp,
                decorative = true,
            )
            // Name and marriages together on the left, so the doubled rule joins two things that
            // are next to each other rather than reaching across the width of the screen.
            Row(
                modifier = Modifier.weight(1f),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f, fill = false)) {
                    Text(
                        text = person.displayName(),
                        style = if (short) {
                            MaterialTheme.typography.titleLarge
                        } else {
                            MaterialTheme.typography.headlineSmall
                        },
                        fontStyle = if (person.isUnnamed) FontStyle.Italic else FontStyle.Normal,
                        color = if (person.isUnnamed) accents.unknown else MaterialTheme.colorScheme.onSurface,
                        maxLines = if (short) 1 else 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = years ?: stringResource(R.string.person_no_dates),
                        style = FTreeText.record,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }

                // Beside the name in a short window, so the whole centre stays one row high.
                if (short) {
                    Row(
                        modifier = Modifier.horizontalScroll(rememberScrollState()),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        focus.partners.forEach { Partner(it, compact = true, onWalkTo = onWalkTo) }
                    }
                }
            }

            // The visible sign that the centre is not merely a label: everything you can do with
            // this person is one tap away, in the same sheet the charts open.
            Icon(
                imageVector = Icons.Default.MoreHoriz,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        if (!short) {
            focus.partners.forEach { partner ->
                HorizontalDivider(
                    modifier = Modifier.padding(horizontal = 16.dp),
                    color = accents.rule,
                )
                Partner(partner, compact = false, onWalkTo = onWalkTo)
            }
        }
    }
}

/**
 * Somebody the centre married, joined to them by the chart's doubled rule.
 *
 * A line of its own under the name where there is room, and a chip beside it where there is not.
 * Either way it is tapped to walk: a marriage is a step through the family like any other.
 */
@Composable
private fun Partner(
    partner: Person,
    compact: Boolean,
    onWalkTo: (String) -> Unit,
) {
    val accents = FTreeTheme.accents
    val spoken = spokenName(partner)
    val years = partner.lifespanLabel(stringResource(R.string.person_late))

    Row(
        modifier = Modifier
            .then(if (compact) Modifier else Modifier.fillMaxWidth())
            .clip(RoundedCornerShape(if (compact) 14.dp else 0.dp))
            .clickable(
                onClickLabel = stringResource(R.string.compact_walk_to, partner.displayName()),
                onClick = { onWalkTo(partner.id) },
            )
            .padding(horizontal = if (compact) 8.dp else 16.dp, vertical = 10.dp)
            .semantics(mergeDescendants = true) { contentDescription = spoken }
            .testTag(compactPersonTag(partner.id)),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(if (compact) 8.dp else 12.dp),
    ) {
        MarriageMark()
        PersonAvatar(partner, diameter = if (compact) 30.dp else 36.dp, decorative = true)
        Text(
            text = partner.displayName(),
            style = MaterialTheme.typography.titleSmall,
            fontStyle = if (partner.isUnnamed) FontStyle.Italic else FontStyle.Normal,
            color = if (partner.isUnnamed) accents.unknown else MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = if (compact) Modifier else Modifier.weight(1f),
        )
        if (!compact) {
            years?.let {
                Text(
                    text = it,
                    style = FTreeText.recordSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/**
 * One generation, headed by a ruled label carrying its count.
 *
 * The people run across rather than down. A generation is a row in every drawing of a family tree
 * ever made, and side by side is also what makes this view *compact*: a column of full-width rows
 * would show fewer people per screen than the chart it is meant to relieve.
 */
@Composable
private fun GenerationBand(
    band: CompactBand,
    short: Boolean,
    onWalkTo: (String) -> Unit,
) {
    BandHeading(label = bandLabel(band.offset), count = band.count, short = short)

    // Keyed by the band and by who is in it, so a row scrolled halfway along does not stay
    // scrolled after a tap has replaced everybody in it with somebody else's family.
    key(band.offset, band.groups.firstOrNull()?.ids?.firstOrNull()) {
        LazyRow(
            modifier = Modifier.fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 20.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            // Groups hang from the top, so a two-line name in one of them does not push a
            // neighbouring card off the line the whole generation is read along.
            verticalAlignment = Alignment.Top,
        ) {
            items(band.groups.size, key = { band.groups[it].ids.first() }) { index ->
                val group = band.groups[index]
                // A married pair is measured as one block and both cards fill it. Two cards of
                // different heights joined by a rule read as two things that happen to be next to
                // each other; matched, they read as a marriage.
                Row(
                    modifier = Modifier.height(IntrinsicSize.Max),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    group.people.forEachIndexed { position, person ->
                        if (position > 0) {
                            // Only where there is really a marriage. Somebody who married twice
                            // puts three people in one group, and the outer two never wed.
                            if (group.married(position - 1)) {
                                MarriageMark(Modifier.padding(horizontal = 4.dp))
                            } else {
                                Spacer(Modifier.width(10.dp))
                            }
                        }
                        PersonCard(person, short, onWalkTo)
                    }
                }
            }
        }
    }
}

/**
 * A generation with nobody in it.
 *
 * Only ever drawn for parents and children — the two directions the view walks in. Their absence is
 * a fact worth stating and an obvious thing to fix; the absence of grandparents when there are no
 * parents is neither, and four empty headings would bury the family that is actually recorded.
 */
@Composable
private fun MissingGeneration(
    kind: RelativeKind,
    offset: Int,
    short: Boolean,
    onAdd: (RelativeKind) -> Unit,
) {
    val accents = FTreeTheme.accents
    BandHeading(label = bandLabel(offset), count = 0, short = short)

    val label = stringResource(addRelativeLabel(kind))
    Row(
        modifier = Modifier
            .padding(horizontal = 20.dp)
            .clip(RoundedCornerShape(16.dp))
            .clickable(onClick = { onAdd(kind) })
            // Inset by half its own width, or the clip above would take the outer half of it.
            .drawBehind {
                val stroke = 1.dp.toPx()
                drawRoundRect(
                    color = accents.unknown,
                    topLeft = Offset(stroke / 2f, stroke / 2f),
                    size = Size(size.width - stroke, size.height - stroke),
                    cornerRadius = CornerRadius(16.dp.toPx()),
                    style = Stroke(
                        width = stroke,
                        pathEffect = PathEffect.dashPathEffect(
                            floatArrayOf(4.dp.toPx(), 4.dp.toPx())
                        ),
                    ),
                )
            }
            .padding(horizontal = 16.dp, vertical = if (short) 10.dp else 14.dp)
            .testTag(compactAddTag(kind)),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Icon(
            imageVector = Icons.Default.PersonAddAlt,
            contentDescription = null,
            tint = accents.unknown,
            modifier = Modifier.size(20.dp),
        )
        Text(text = label, style = MaterialTheme.typography.bodyMedium, color = accents.unknown)
    }
}

/**
 * One person, small enough that a whole generation fits across a phone.
 *
 * The name is set in the serif and the years in the mono, as everywhere else a person is listed, so
 * somebody looks like themselves whether you meet them here, in the people list or on the chart.
 * Someone whose name was never recorded keeps the brass dashed ring the rest of the app gives them.
 *
 * The card turns on its side in a short window. A portrait card is a face above a name, which is
 * the better shape when height is what there is plenty of; in landscape that same card is a third
 * of the screen and only two generations would fit, which would make the view that exists to fit
 * things on a screen the worst of the three at it. Laid on its side it is 56dp instead of 130dp
 * and four generations are in view at once.
 */
@Composable
private fun PersonCard(
    person: Person,
    short: Boolean,
    onWalkTo: (String) -> Unit,
) {
    val accents = FTreeTheme.accents
    val years = person.lifespanLabel(stringResource(R.string.person_late))
    val spoken = spokenName(person)
    /*
     * A card is a fixed width, so at a large text size the words have nowhere to go: at 1.6x a
     * lifespan came out as "1905-197", which is not a clipped label but a wrong date. The card grows
     * with the reader's setting on the same curve the chart's cards use, so the two agree about how
     * much room a larger word needs.
     */
    val grown = TreeMetrics.cardScaleFor(LocalDensity.current.fontScale)

    val frame = Modifier
        .clip(RoundedCornerShape(16.dp))
        .background(MaterialTheme.colorScheme.surfaceContainerLow)
        .clickable(
            onClickLabel = stringResource(R.string.compact_walk_to, person.displayName()),
            onClick = { onWalkTo(person.id) },
        )
        // One node for the reader rather than three: an avatar, a name and a year announced
        // separately is three swipes to learn about one person.
        .semantics(mergeDescendants = true) { contentDescription = spoken }
        .testTag(compactPersonTag(person.id))

    val name: @Composable (TextAlign) -> kotlin.Unit = { align ->
        Text(
            text = person.displayName(),
            style = MaterialTheme.typography.titleSmall,
            fontStyle = if (person.isUnnamed) FontStyle.Italic else FontStyle.Normal,
            color = if (person.isUnnamed) accents.unknown else MaterialTheme.colorScheme.onSurface,
            textAlign = align,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
    }
    // Left out entirely rather than blanked when nothing is recorded: a card matches its partner's
    // height through the group it sits in, so an empty line here would only pad the ones standing
    // on their own.
    val lifespan: @Composable (TextAlign) -> kotlin.Unit = { align ->
        years?.let {
            Text(
                text = it,
                style = FTreeText.recordSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = align,
                maxLines = 1,
                // Ellipsis rather than the default clip: a year cut short still reads as a year,
                // and "1905-197" is a date this family never had.
                overflow = TextOverflow.Ellipsis,
            )
        }
    }

    if (short) {
        Row(
            modifier = frame.width(180.dp * grown).fillMaxHeight().padding(horizontal = 10.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            PersonAvatar(person, diameter = 36.dp, decorative = true)
            Column(Modifier.weight(1f)) {
                name(TextAlign.Start)
                lifespan(TextAlign.Start)
            }
        }
    } else {
        Column(
            modifier = frame
                .width(104.dp * grown)
                .fillMaxHeight()
                .padding(horizontal = 8.dp, vertical = 10.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            PersonAvatar(person, diameter = 48.dp, decorative = true)
            name(TextAlign.Center)
            // Pushed to the foot of the card, so the years line up across a couple even when one
            // of the two names runs to a second line. The year column lining up is the same habit
            // the people list has.
            Spacer(Modifier.weight(1f))
            lifespan(TextAlign.Center)
        }
    }
}

/**
 * The chart's doubled rule for a marriage, at the size of a word.
 *
 * The notation is deliberately the same mark as on the chart. Two views of one family that spell a
 * marriage differently would be two notations to learn instead of one.
 */
@Composable
private fun MarriageMark(modifier: Modifier = Modifier) {
    val colour = FTreeTheme.accents.spouseLink
    Canvas(modifier.width(14.dp).height(8.dp)) {
        val stroke = 1.5.dp.toPx()
        val gap = 2.dp.toPx()
        drawLine(colour, Offset(0f, center.y - gap), Offset(size.width, center.y - gap), stroke)
        drawLine(colour, Offset(0f, center.y + gap), Offset(size.width, center.y + gap), stroke)
    }
}

/** A ruled heading with the band's count in the mono voice, so the numbers line up down the page. */
@Composable
private fun BandHeading(label: String, count: Int, short: Boolean = false) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(start = 20.dp, end = 20.dp, top = if (short) 10.dp else 14.dp, bottom = 6.dp),
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
        if (count > 0) {
            Text(
                text = count.toString(),
                style = FTreeText.record,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * The way further back.
 *
 * Shown at the top rather than beside the chart's icon because this is a document you read
 * downwards: "there is more above this" belongs above it, where the reader has run out.
 */
@Composable
private fun MoreGenerations(onClick: () -> Unit) {
    Box(Modifier.fillMaxWidth().padding(top = 8.dp), contentAlignment = Alignment.Center) {
        TextButton(onClick = onClick, modifier = Modifier.testTag(CompactMoreGenerationsTag)) {
            Icon(
                imageVector = Icons.Default.KeyboardArrowUp,
                contentDescription = null,
                modifier = Modifier.size(18.dp),
            )
            Spacer(Modifier.width(6.dp))
            Text(stringResource(R.string.tree_more_generations))
        }
    }
}

/**
 * How far a band sits from the focus, said as a family says it.
 *
 * Worked out from the number rather than listed case by case, so loading two more generations needs
 * no new words: past grandparents it is the same "great-" the relation finder uses.
 */
@Composable
private fun bandLabel(offset: Int): String = when (offset) {
    -1 -> stringResource(R.string.section_parents)
    0 -> stringResource(R.string.section_siblings)
    1 -> stringResource(R.string.section_children)
    else -> {
        val base = if (offset < 0) R.string.compact_grandparents else R.string.compact_grandchildren
        stringResource(R.string.kin_great_prefix).repeat(abs(offset) - 2) + stringResource(base)
    }
}

/** "Kinshuk Srivastava, 1962" — one sentence for a screen reader instead of three fragments. */
@Composable
private fun spokenName(person: Person): String {
    val name = person.displayName()
    val years = person.lifespanLabel(stringResource(R.string.person_late))
    return if (years == null) name else stringResource(R.string.a11y_compact_person, name, years)
}
