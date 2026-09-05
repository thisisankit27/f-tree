package com.vibethroughcode.ftree.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.AccountTree
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import com.vibethroughcode.ftree.R
import com.vibethroughcode.ftree.transfer.TreeDocument
import com.vibethroughcode.ftree.ui.people.PeopleScreen
import com.vibethroughcode.ftree.ui.person.PersonDetailScreen
import com.vibethroughcode.ftree.ui.person.PersonEditScreen
import com.vibethroughcode.ftree.ui.relation.RelationScreen
import com.vibethroughcode.ftree.ui.relative.AddRelativeScreen
import com.vibethroughcode.ftree.ui.settings.SettingsScreen
import com.vibethroughcode.ftree.ui.settings.SettingsViewModel
import com.vibethroughcode.ftree.ui.transfer.ImportReviewScreen
import com.vibethroughcode.ftree.ui.transfer.TransferMessages
import com.vibethroughcode.ftree.ui.transfer.TransferViewModel
import com.vibethroughcode.ftree.ui.transfer.defaultExportName
import com.vibethroughcode.ftree.ui.tree.TreeScreen
import kotlin.reflect.KClass

const val NavTreeTag = "nav-tree"
const val NavPeopleTag = "nav-people"
const val NavSettingsTag = "nav-settings"

/** The three places the app is, rather than three of the places it can go. */
private data class Destination(
    val route: Any,
    val type: KClass<*>,
    val icon: ImageVector,
    val label: Int,
    val tag: String,
)

private val destinations = listOf(
    Destination(TreeRoute(), TreeRoute::class, Icons.Default.AccountTree, R.string.nav_tree, NavTreeTag),
    Destination(PeopleRoute, PeopleRoute::class, Icons.AutoMirrored.Filled.List, R.string.nav_people, NavPeopleTag),
    Destination(SettingsRoute, SettingsRoute::class, Icons.Default.Settings, R.string.nav_settings, NavSettingsTag),
)

/**
 * The app shell.
 *
 * The three top-level places sit in a navigation bar rather than behind icons and an overflow menu.
 * The people list and the settings were previously reachable only from the chart's app bar, which
 * made two of the app's three halves feel like accessories to the third.
 *
 * Import and export live here rather than on any one screen: a transfer is an operation on the
 * whole tree, its result belongs in an app-level snackbar, and the import review has to survive
 * whichever screen started it.
 */
@Composable
fun FTreeApp() {
    val navController = rememberNavController()
    val snackbarHostState = remember { SnackbarHostState() }
    val transferViewModel: TransferViewModel = viewModel(factory = FTreeViewModels.Factory)

    TransferMessages(transferViewModel, snackbarHostState)

    val exportPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument(TreeDocument.MIME_TYPE)
    ) { uri -> uri?.let(transferViewModel::export) }

    // Any type is accepted: providers disagree about what a .ftree file is, and refusing to show
    // the user's own export because a provider called it octet-stream would be absurd. The file
    // itself is validated on read.
    val importPicker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri -> uri?.let(transferViewModel::prepareImport) }

    val backStackEntry by navController.currentBackStackEntryAsState()
    val destination = backStackEntry?.destination
    val onTopLevel = destinations.any { destination?.hasRoute(it.type) == true }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        bottomBar = {
            if (onTopLevel) {
                NavigationBar {
                    destinations.forEach { item ->
                        val selected = destination?.hasRoute(item.type) == true
                        NavigationBarItem(
                            selected = selected,
                            onClick = { navController.switchTo(item.route) },
                            icon = { Icon(item.icon, contentDescription = null) },
                            label = { Text(stringResource(item.label)) },
                            modifier = Modifier.testTag(item.tag),
                        )
                    }
                }
            }
        },
    ) { padding ->
        NavHost(
            navController = navController,
            startDestination = TreeRoute(),
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            composable<TreeRoute> { entry ->
                TreeScreen(
                    trace = entry.toRoute<TreeRoute>().trace,
                    startWhole = entry.toRoute<TreeRoute>().whole,
                    onOpenPerson = { navController.navigate(PersonRoute(it)) },
                    onAddPerson = { navController.navigate(EditPersonRoute()) },
                    onAddRelative = { anchorId, kind ->
                        navController.navigate(AddRelativeRoute(anchorId, kind))
                    },
                    onRelate = { navController.navigate(RelationRoute(fromId = it)) },
                    // Dropping the trace means going back to the plain chart, which is where
                    // clearing a highlight should leave you — not one screen further back.
                    onClearTrace = {
                        navController.navigate(TreeRoute(whole = true)) {
                            popUpTo<TreeRoute> { inclusive = true }
                        }
                    },
                )
            }

            composable<RelationRoute> {
                RelationScreen(
                    onBack = { navController.popBackStack() },
                    onOpenPerson = { navController.navigate(PersonRoute(it)) },
                    onShowOnChart = { trace ->
                        navController.navigate(TreeRoute(trace = trace)) {
                            popUpTo<TreeRoute> { inclusive = true }
                        }
                    },
                )
            }

            composable<PeopleRoute> {
                PeopleScreen(
                    onOpenPerson = { navController.navigate(PersonRoute(it)) },
                    onAddPerson = { navController.navigate(EditPersonRoute()) },
                )
            }

            composable<SettingsRoute> {
                val settingsViewModel: SettingsViewModel =
                    viewModel(factory = FTreeViewModels.Factory)
                SettingsScreen(
                    onExport = { exportPicker.launch(defaultExportName()) },
                    onImport = { importPicker.launch(arrayOf("*/*")) },
                    viewModel = settingsViewModel,
                )
            }

            composable<PersonRoute> {
                PersonDetailScreen(
                    onBack = { navController.popBackStack() },
                    onEdit = { navController.navigate(EditPersonRoute(it)) },
                    onOpenPerson = { navController.navigate(PersonRoute(it)) },
                    onAddRelative = { anchorId, kind ->
                        navController.navigate(AddRelativeRoute(anchorId, kind))
                    },
                    onShowOnTree = { personId ->
                        navController.navigate(TreeRoute(focusId = personId)) {
                            popUpTo<TreeRoute> { inclusive = true }
                        }
                    },
                    onRelate = { personId ->
                        navController.navigate(RelationRoute(fromId = personId))
                    },
                )
            }

            composable<AddRelativeRoute> {
                AddRelativeScreen(onBack = { navController.popBackStack() })
            }

            composable<EditPersonRoute> { entry ->
                val route = entry.toRoute<EditPersonRoute>()
                PersonEditScreen(
                    onBack = { navController.popBackStack() },
                    onSaved = { personId ->
                        if (route.personId == null) {
                            // A newly added person opens straight onto their own page, which is
                            // where the next thing you want to do — add a relative — lives. Only
                            // the form is dropped from the back stack, so going back returns to
                            // wherever the add started rather than always to the chart.
                            navController.navigate(PersonRoute(personId)) {
                                popUpTo<EditPersonRoute> { inclusive = true }
                            }
                        } else {
                            navController.popBackStack()
                        }
                    },
                )
            }
        }
    }

    // Shown over whatever started it rather than as a navigation destination: the plan is a live
    // object that cannot be handed through a route, and backing out must leave the tree untouched.
    val importPlan by transferViewModel.plan.collectAsStateWithLifecycle()
    val importDecisions by transferViewModel.decisions.collectAsStateWithLifecycle()
    val allPeople by transferViewModel.localPeople.collectAsStateWithLifecycle()

    importPlan?.let { plan ->
        Dialog(
            onDismissRequest = transferViewModel::cancelImport,
            properties = DialogProperties(
                usePlatformDefaultWidth = false,
                // Fills the screen properly instead of leaving the scrim showing behind the status
                // and navigation bars.
                decorFitsSystemWindows = false,
            ),
        ) {
            ImportReviewScreen(
                plan = plan,
                decisions = importDecisions,
                localPeople = allPeople,
                onDecision = transferViewModel::setDecision,
                onConfirm = transferViewModel::confirmImport,
                onCancel = transferViewModel::cancelImport,
            )
        }
    }
}

/**
 * Moves between the three top-level places without stacking them.
 *
 * Saving and restoring state means the chart keeps its pan and zoom, and the people list its scroll
 * position, when you step away to settings and back.
 */
private fun NavHostController.switchTo(route: Any) {
    navigate(route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}
