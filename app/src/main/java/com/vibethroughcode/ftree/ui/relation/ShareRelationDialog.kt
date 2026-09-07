package com.vibethroughcode.ftree.ui.relation

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Share
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.layer.drawLayer
import androidx.compose.ui.graphics.rememberGraphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.graph.Relation
import com.vibethroughcode.ftree.ui.common.displayName
import com.vibethroughcode.ftree.ui.theme.FTreeText
import kotlinx.coroutines.launch

const val ShareCardTreeTag = "share-card-tree"
const val ShareCardListTag = "share-card-list"
const val ShareCardSendTag = "share-card-send"
const val ShareCardPreviewTag = "share-card-preview"

/** The picture that will be sent, and what will be said beside it. */
data class RelationPicture(val image: ImageBitmap, val name: String, val caption: String)

/**
 * Seeing the card before sending it.
 *
 * The preview *is* the card: the same composable is drawn on screen and recorded into the file, so
 * there is no second rendering that could disagree with what was shown. It is scaled to fit rather
 * than re-laid out, which is why the picture is the same 1080 x 1350 whatever phone made it.
 *
 * A picture rather than a screenshot, and rather than a document. A chat app treats a picture as
 * something to say a sentence about and shows the message beside it; handed a file, the same app
 * quietly drops it.
 */
@Composable
fun ShareRelationDialog(
    state: RelationUiState,
    relation: Relation.Found,
    onDismiss: () -> Unit,
    onSend: (RelationPicture) -> Unit,
) {
    var style by rememberSaveable { mutableStateOf(CardStyle.TREE) }
    var working by remember { mutableStateOf(false) }
    val layer = rememberGraphicsLayer()
    val scope = rememberCoroutineScope()

    val answer = answerSentence(state, relation)
    val fromName = state.from?.displayName().orEmpty()
    val toName = state.to?.displayName().orEmpty()
    val headline = answer?.sentence
        ?: stringResource(R.string.card_connected, fromName, toName)
    val caption = stringResource(R.string.card_caption, headline, stringResource(R.string.card_footer))
    val fileName = state.to?.name.orEmpty().ifBlank { "relationship" }

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false),
    ) {
        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surfaceContainerLowest) {
            Column(
                Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .navigationBarsPadding(),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth().padding(start = 4.dp, end = 12.dp, top = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onDismiss) {
                        Icon(Icons.Default.Close, contentDescription = stringResource(R.string.edit_back))
                    }
                    Text(
                        text = stringResource(R.string.card_title),
                        style = MaterialTheme.typography.titleLarge,
                        modifier = Modifier.weight(1f),
                    )
                }

                Box(
                    modifier = Modifier.fillMaxWidth().weight(1f).padding(horizontal = 20.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    CardPreview(state, relation, style, layer)
                }

                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .widthIn(max = 480.dp)
                        .padding(horizontal = 20.dp, vertical = 12.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp),
                ) {
                    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                        SegmentedButton(
                            selected = style == CardStyle.TREE,
                            onClick = { style = CardStyle.TREE },
                            shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
                            modifier = Modifier.testTag(ShareCardTreeTag),
                        ) { Text(stringResource(R.string.card_style_tree)) }
                        SegmentedButton(
                            selected = style == CardStyle.LIST,
                            onClick = { style = CardStyle.LIST },
                            shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
                            modifier = Modifier.testTag(ShareCardListTag),
                        ) { Text(stringResource(R.string.card_style_list)) }
                    }

                    // Shown rather than hidden: somebody about to post this in a family group should
                    // know what is going with it before the chat app opens, not after.
                    Column {
                        Text(
                            text = stringResource(R.string.card_caption_label),
                            style = FTreeText.sectionLabel,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            text = caption,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 6.dp),
                        )
                    }

                    Button(
                        onClick = {
                            if (working) return@Button
                            working = true
                            scope.launch {
                                val image = layer.toImageBitmap()
                                onSend(RelationPicture(image, fileName, caption))
                                working = false
                            }
                        },
                        modifier = Modifier.fillMaxWidth().testTag(ShareCardSendTag),
                    ) {
                        if (working) {
                            CircularProgressIndicator(
                                Modifier.size(18.dp),
                                strokeWidth = 2.dp,
                                color = MaterialTheme.colorScheme.onPrimary,
                            )
                        } else {
                            Icon(Icons.Default.Share, contentDescription = null, modifier = Modifier.size(18.dp))
                        }
                        Spacer(Modifier.size(10.dp))
                        Text(stringResource(R.string.card_send))
                    }
                }
            }
        }
    }
}

/**
 * The card at its true size, shown at whatever size the screen has.
 *
 * The density inside is pinned rather than taken from the device, which is what makes the picture
 * identical from every phone: three pixels to the point means the 360 by 450 card is always
 * 1080 by 1350. The preview then scales that down to fit, after layout, so nothing is re-measured
 * and the thing recorded is exactly the thing on screen.
 */
@Composable
private fun CardPreview(
    state: RelationUiState,
    relation: Relation.Found,
    style: CardStyle,
    layer: androidx.compose.ui.graphics.layer.GraphicsLayer,
) {
    val outer = LocalDensity.current
    BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        val widthPx = CARD_PIXEL_WIDTH
        val heightPx = CARD_PIXEL_HEIGHT
        val scale = minOf(
            constraints.maxWidth / widthPx.toFloat(),
            constraints.maxHeight / heightPx.toFloat(),
        ).coerceAtMost(1f)

        Box(
            modifier = Modifier
                .size(with(outer) { (widthPx * scale).toDp() }, with(outer) { (heightPx * scale).toDp() })
                .testTag(ShareCardPreviewTag),
        ) {
            CompositionLocalProvider(LocalDensity provides Density(CARD_DENSITY, 1f)) {
                Box(
                    Modifier
                        .requiredSize(CARD_WIDTH, CARD_HEIGHT)
                        .graphicsLayer {
                            scaleX = scale
                            scaleY = scale
                            transformOrigin = TransformOrigin(0f, 0f)
                        }
                        .drawWithContent {
                            layer.record { this@drawWithContent.drawContent() }
                            drawLayer(layer)
                        },
                ) {
                    RelationCard(state = state, relation = relation, style = style)
                }
            }
        }
    }
}

/**
 * Three pixels to the point, and the size that falls out of it.
 *
 * Pinned rather than read from the device so that the same relationship makes the same picture on
 * every phone — and so the file is the shape a chat app expects rather than whatever aspect the
 * sender's screen happened to be.
 */
const val CARD_DENSITY = 3f
const val CARD_PIXEL_WIDTH = 1080
const val CARD_PIXEL_HEIGHT = 1350
