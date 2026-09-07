package com.vibethroughcode.ftree.ui.settings

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.Download
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Upload
import androidx.compose.material3.AlertDialog
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.vibethroughcode.ftree.BuildConfig
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.data.KinshipLanguage
import com.vibethroughcode.ftree.ui.common.SectionRule
import com.vibethroughcode.ftree.ui.common.readableMeasure
import com.vibethroughcode.ftree.ui.theme.FTreeText
import com.vibethroughcode.ftree.ui.theme.FTreeTheme
import com.vibethroughcode.ftree.update.AvailableUpdate
import com.vibethroughcode.ftree.update.UpdateFailure
import com.vibethroughcode.ftree.update.UpdateState

const val SettingsUpdatesToggleTag = "settings-updates-toggle"
const val SettingsPhotosToggleTag = "settings-photos-toggle"
const val SettingsWordsEnglishTag = "settings-words-english"
const val SettingsWordsHindiTag = "settings-words-hindi"
const val SettingsExportTag = "settings-export"
const val SettingsImportTag = "settings-import"
const val SettingsBetaToggleTag = "settings-beta-toggle"
const val SettingsBetaConfirmTag = "settings-beta-confirm"

/**
 * Settings, and the only place in the app that can reach the network.
 *
 * The updater is written to be read as much as used: the switch says plainly that it is the one
 * networked thing here, and that an update installs *over* this copy so the family is carried
 * across. That last point is the entire reason the feature exists — without it, moving to a new
 * version means exporting, uninstalling, reinstalling and importing.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onExport: () -> Unit,
    onImport: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: SettingsViewModel,
) {
    val context = LocalContext.current
    val enabled by viewModel.updatesEnabled.collectAsStateWithLifecycle()
    val state by viewModel.updateState.collectAsStateWithLifecycle()
    val photosInChart by viewModel.photosInChart.collectAsStateWithLifecycle()
    val kinshipLanguage by viewModel.kinshipLanguage.collectAsStateWithLifecycle()
    val betaChannel by viewModel.betaChannel.collectAsStateWithLifecycle()
    var confirmingBeta by remember { mutableStateOf(false) }

    // One measure for the screen, so the title above the settings sits over the settings rather
    // than over the middle of the glass. See `readableMeasure`.
    Scaffold(
        modifier = modifier.readableMeasure(),
        topBar = {
            CenterAlignedTopAppBar(title = { Text(stringResource(R.string.settings_title)) })
        },
    ) { padding ->
    Column(
        modifier = Modifier
            .fillMaxHeight()
            .padding(padding)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp),
    ) {
        SectionRule(stringResource(R.string.settings_section_words))

        Text(
            stringResource(R.string.settings_words_body),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp, bottom = 12.dp),
        )
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            SegmentedButton(
                selected = kinshipLanguage == KinshipLanguage.ENGLISH,
                onClick = { viewModel.setKinshipLanguage(KinshipLanguage.ENGLISH) },
                shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
                modifier = Modifier.testTag(SettingsWordsEnglishTag),
            ) { Text(stringResource(R.string.settings_words_english)) }

            SegmentedButton(
                selected = kinshipLanguage == KinshipLanguage.HINDI,
                onClick = { viewModel.setKinshipLanguage(KinshipLanguage.HINDI) },
                shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
                modifier = Modifier.testTag(SettingsWordsHindiTag),
            ) { Text(stringResource(R.string.settings_words_hindi)) }
        }

        SectionRule(stringResource(R.string.settings_section_chart))

        SettingsSwitch(
            title = stringResource(R.string.settings_photos_toggle),
            body = stringResource(R.string.settings_photos_explainer),
            checked = photosInChart,
            onCheckedChange = viewModel::setPhotosInChart,
            tag = SettingsPhotosToggleTag,
        )

        SectionRule(stringResource(R.string.settings_section_updates))

        SettingsSwitch(
            title = stringResource(R.string.settings_updates_toggle),
            body = stringResource(R.string.settings_updates_explainer),
            checked = enabled,
            onCheckedChange = viewModel::setUpdatesEnabled,
            tag = SettingsUpdatesToggleTag,
        )

        AnimatedVisibility(visible = enabled) {
            UpdatePanel(
                state = state,
                onCheck = viewModel::check,
                onDownload = viewModel::download,
                onCancel = viewModel::cancel,
                onInstall = { file ->
                    if (viewModel.canInstall()) {
                        viewModel.install(file)
                    } else {
                        context.startActivity(viewModel.permissionIntent())
                    }
                },
                onSkip = viewModel::skip,
                onDismiss = viewModel::dismissFailure,
            )
        }

        SectionRule(stringResource(R.string.settings_section_data))

        SettingsAction(
            icon = { Icon(Icons.Default.Upload, contentDescription = null) },
            title = stringResource(R.string.settings_export),
            body = stringResource(R.string.settings_export_body),
            onClick = onExport,
            modifier = Modifier.testTag(SettingsExportTag),
        )
        SettingsAction(
            icon = { Icon(Icons.Default.Download, contentDescription = null) },
            title = stringResource(R.string.settings_import),
            body = stringResource(R.string.settings_import_body),
            onClick = onImport,
            modifier = Modifier.testTag(SettingsImportTag),
        )

        SectionRule(stringResource(R.string.settings_section_about))

        Text(
            stringResource(R.string.about_body),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            stringResource(R.string.settings_version, BuildConfig.VERSION_NAME),
            style = FTreeText.record,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 12.dp),
        )

        TextButton(
            onClick = {
                context.startActivity(
                    Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.RELEASES_PAGE_URL))
                )
            },
            modifier = Modifier.padding(top = 4.dp),
        ) {
            Text(stringResource(R.string.settings_source))
            Spacer(Modifier.size(6.dp))
            Icon(Icons.Default.OpenInNew, contentDescription = null, modifier = Modifier.size(16.dp))
        }

        Text(
            stringResource(R.string.settings_permissions_title).uppercase(),
            style = FTreeText.sectionLabel,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 16.dp),
        )
        Text(
            stringResource(R.string.settings_permissions_body),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp),
        )
        Text(
            stringResource(R.string.about_fonts),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 16.dp),
        )

        /*
         * Last on the page, and meant to be.
         *
         * A beta is an unfinished build of an app somebody keeps their family in. Putting it under
         * the licence notice rather than beside "Check for updates" is the honest placement: it is
         * for people who came looking for it, and nobody should meet it while turning ordinary
         * updates on.
         */
        SectionRule(stringResource(R.string.settings_section_beta))
        SettingsSwitch(
            title = stringResource(R.string.settings_beta_toggle),
            body = stringResource(
                if (enabled) R.string.settings_beta_explainer
                else R.string.settings_beta_explainer_updates_off
            ),
            checked = betaChannel,
            enabled = enabled,
            onCheckedChange = { wanted ->
                // Turning it off is not a decision worth interrupting; turning it on is.
                if (wanted) confirmingBeta = true else viewModel.setBetaChannel(false)
            },
            tag = SettingsBetaToggleTag,
        )

        Spacer(Modifier.height(40.dp))
    }
    }

    if (confirmingBeta) {
        BetaOptInDialog(
            onDismiss = { confirmingBeta = false },
            onConfirm = {
                confirmingBeta = false
                viewModel.setBetaChannel(true)
            },
        )
    }
}

/**
 * What somebody is agreeing to before the updater will offer them an unfinished build.
 *
 * It states the one consequence that is not obvious and cannot be undone by flicking the switch
 * back: Android will not install an older version over a newer one, so a beta keeps you on betas
 * until the stable release passes it. Everything else here is a risk somebody can weigh; that is a
 * fact they would otherwise discover afterwards.
 */
@Composable
private fun BetaOptInDialog(onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = { Icon(Icons.Default.WarningAmber, contentDescription = null) },
        title = { Text(stringResource(R.string.settings_beta_dialog_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    stringResource(R.string.settings_beta_dialog_body),
                    style = MaterialTheme.typography.bodyMedium,
                )
                Text(
                    stringResource(R.string.settings_beta_dialog_export),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = onConfirm, modifier = Modifier.testTag(SettingsBetaConfirmTag)) {
                Text(stringResource(R.string.settings_beta_dialog_confirm))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.settings_beta_dialog_cancel))
            }
        },
    )
}

/**
 * A setting with its explanation, and the switch that turns it.
 *
 * The whole row is the target, not just the switch. Reaching a 32dp control at the far edge of a
 * phone is the sort of thing that is fine in a mock-up and irritating in the hand, and the sentence
 * explaining a setting is the most natural thing to press.
 */
@Composable
private fun SettingsSwitch(
    title: String,
    body: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    tag: String,
    enabled: Boolean = true,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .toggleable(
                value = checked,
                enabled = enabled,
                onValueChange = onCheckedChange,
                role = Role.Switch,
            )
            .padding(vertical = 8.dp)
            .testTag(tag),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge)
            Text(
                body,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 4.dp),
            )
        }
        // Driven by the row, so the two cannot disagree and a screen reader hears one control.
        Switch(checked = checked, onCheckedChange = null)
    }
}

/** The one part of the screen that changes: where an update attempt has got to. */
@Composable
private fun UpdatePanel(
    state: UpdateState,
    onCheck: () -> Unit,
    onDownload: (AvailableUpdate) -> Unit,
    onCancel: () -> Unit,
    onInstall: (java.io.File) -> Unit,
    onSkip: (AvailableUpdate) -> Unit,
    onDismiss: () -> Unit,
) {
    Column(Modifier.padding(top = 16.dp)) {
        when (state) {
            UpdateState.Disabled, UpdateState.Idle -> {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedButton(onClick = onCheck) {
                        Text(stringResource(R.string.settings_updates_check_now))
                    }
                }
            }

            UpdateState.Checking -> Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp)
                Text(
                    stringResource(R.string.settings_updates_checking),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }

            is UpdateState.UpToDate -> Column {
                Text(
                    stringResource(R.string.settings_updates_current),
                    style = MaterialTheme.typography.bodyMedium,
                )
                OutlinedButton(onClick = onCheck, modifier = Modifier.padding(top = 8.dp)) {
                    Text(stringResource(R.string.settings_updates_check_now))
                }
            }

            is UpdateState.Available -> UpdateCard {
                Text(
                    stringResource(R.string.settings_update_available, state.update.version.toString()),
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(
                    stringResource(R.string.settings_update_size, formatBytes(state.update.sizeBytes)),
                    style = FTreeText.recordSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 2.dp),
                )
                state.update.notes?.let { notes ->
                    Text(
                        notes.lineSequence().take(6).joinToString("\n"),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 10.dp),
                    )
                }
                Row(
                    modifier = Modifier.padding(top = 14.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    Button(onClick = { onDownload(state.update) }) {
                        Icon(Icons.Default.CloudDownload, contentDescription = null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.size(8.dp))
                        Text(stringResource(R.string.settings_update_download))
                    }
                    TextButton(onClick = { onSkip(state.update) }) {
                        Text(stringResource(R.string.settings_update_skip))
                    }
                }
            }

            is UpdateState.Downloading -> UpdateCard {
                Text(
                    stringResource(R.string.settings_update_downloading, (state.progress * 100).toInt()),
                    style = MaterialTheme.typography.titleSmall,
                )
                LinearProgressIndicator(
                    progress = { state.progress },
                    modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
                )
                TextButton(onClick = onCancel, modifier = Modifier.padding(top = 6.dp)) {
                    Text(stringResource(R.string.settings_update_cancel))
                }
            }

            is UpdateState.Ready -> UpdateCard {
                Text(
                    stringResource(R.string.settings_update_ready, state.update.version.toString()),
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(
                    stringResource(R.string.settings_update_ready_body),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 6.dp),
                )
                Button(
                    onClick = { onInstall(state.file) },
                    modifier = Modifier.padding(top = 14.dp),
                ) {
                    Text(stringResource(R.string.settings_update_install))
                }
            }

            is UpdateState.Failed -> UpdateCard(warning = true) {
                Text(
                    stringResource(state.failure.message()),
                    style = MaterialTheme.typography.bodyMedium,
                )
                Row(
                    modifier = Modifier.padding(top = 10.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    OutlinedButton(onClick = onCheck) {
                        Text(stringResource(R.string.settings_updates_check_now))
                    }
                    TextButton(onClick = onDismiss) {
                        Text(stringResource(R.string.settings_update_cancel))
                    }
                }
            }
        }

        Text(
            stringResource(R.string.settings_updates_keeps_data),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 14.dp),
        )
    }
}

@Composable
private fun UpdateCard(
    warning: Boolean = false,
    content: @Composable () -> Unit,
) {
    Surface(
        color = if (warning) FTreeTheme.accents.unknownSurface
        else MaterialTheme.colorScheme.surfaceVariant,
        shape = MaterialTheme.shapes.medium,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(16.dp)) { content() }
    }
}

@Composable
private fun SettingsAction(
    icon: @Composable () -> Unit,
    title: String,
    body: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        TextButton(onClick = onClick, modifier = Modifier.weight(1f)) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                verticalAlignment = Alignment.Top,
            ) {
                Column(Modifier.padding(top = 2.dp)) { icon() }
                Column(Modifier.weight(1f)) {
                    Text(
                        title,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        body,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 2.dp),
                    )
                }
            }
        }
    }
}

private fun UpdateFailure.message(): Int = when (this) {
    UpdateFailure.NETWORK -> R.string.update_failed_network
    UpdateFailure.SERVER -> R.string.update_failed_server
    UpdateFailure.RATE_LIMITED -> R.string.update_failed_rate_limited
    UpdateFailure.NO_RELEASES -> R.string.update_failed_no_releases
    UpdateFailure.INSECURE_URL -> R.string.update_failed_insecure
    UpdateFailure.TRUNCATED -> R.string.update_failed_truncated
    UpdateFailure.STORAGE -> R.string.update_failed_storage
    UpdateFailure.CHECKSUM -> R.string.update_failed_checksum
    UpdateFailure.SIGNATURE -> R.string.update_failed_signature
    UpdateFailure.WRONG_PACKAGE -> R.string.update_failed_wrong_package
    UpdateFailure.INSTALL_NOT_PERMITTED -> R.string.update_failed_install_not_permitted
}

private fun formatBytes(bytes: Long): String = when {
    bytes <= 0 -> "—"
    bytes < 1024 * 1024 -> "${bytes / 1024} KB"
    else -> String.format("%.1f MB", bytes / 1024.0 / 1024.0)
}
