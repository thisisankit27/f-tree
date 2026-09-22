package com.vibethroughcode.ftree.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.CreationExtras
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.toRoute
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.book.BookComposer
import com.vibethroughcode.ftree.ui.book.BookViewModel
import com.vibethroughcode.ftree.data.FamilyRepository
import com.vibethroughcode.ftree.data.PhotoStore
import com.vibethroughcode.ftree.ui.people.PeopleViewModel
import com.vibethroughcode.ftree.ui.person.PersonDetailViewModel
import com.vibethroughcode.ftree.ui.person.PersonEditViewModel
import com.vibethroughcode.ftree.ui.relation.RelationViewModel
import com.vibethroughcode.ftree.ui.relative.AddRelativeViewModel
import com.vibethroughcode.ftree.ui.transfer.TransferViewModel
import com.vibethroughcode.ftree.ui.nearby.NearbyViewModel
import com.vibethroughcode.ftree.ui.settings.SettingsViewModel
import com.vibethroughcode.ftree.ui.tree.TreeViewModel
import com.vibethroughcode.ftree.ui.tree.WholeTreeViewModel

private fun CreationExtras.repository(): FamilyRepository =
    (this[APPLICATION_KEY] as FTreeApplication).container.familyRepository

private fun CreationExtras.photos(): PhotoStore =
    (this[APPLICATION_KEY] as FTreeApplication).container.photoStore

/**
 * Wires view models by hand.
 *
 * The saved-state handle carries the navigation arguments, so a view model survives process death
 * with the person it was showing rather than reopening on an empty screen.
 */
object FTreeViewModels {
    val Factory = viewModelFactory {
        initializer { PeopleViewModel(repository()) }
        initializer {
            val app = this[APPLICATION_KEY] as FTreeApplication
            TreeViewModel(repository(), app.container.chartPreferences, createSavedStateHandle())
        }
        initializer { WholeTreeViewModel(repository()) }
        initializer {
            val app = this[APPLICATION_KEY] as FTreeApplication
            SettingsViewModel(
                preferences = app.container.updatePreferences,
                chart = app.container.chartPreferences,
                kinship = app.container.kinshipPreferences,
                updates = app.container.updateRepository,
                nearbyPreferences = app.container.nearbyPreferences,
                nearbyIdentity = app.container.nearbyIdentity,
                nearbyRepository = app.container.nearbyRepository,
                reminderPreferences = app.container.reminderPreferences,
                reminders = app.container.reminders,
            )
        }
        initializer {
            val app = this[APPLICATION_KEY] as FTreeApplication
            TransferViewModel(
                exporter = app.container.exporter,
                importer = app.container.importer,
                branchShare = app.container.branchShare,
                contentResolver = app.contentResolver,
                repository = app.container.familyRepository,
            )
        }
        initializer {
            val app = this[APPLICATION_KEY] as FTreeApplication
            NearbyViewModel(
                repository = app.container.nearbyRepository,
                identity = app.container.nearbyIdentity,
                exporter = app.container.exporter,
                outgoingDirectory = java.io.File(app.cacheDir, "nearby-out"),
            )
        }
        initializer {
            val handle: SavedStateHandle = createSavedStateHandle()
            PersonDetailViewModel(repository(), handle.toRoute<PersonRoute>().personId)
        }
        initializer {
            val handle: SavedStateHandle = createSavedStateHandle()
            PersonEditViewModel(
                repository = repository(),
                photos = photos(),
                personId = handle.toRoute<EditPersonRoute>().personId,
                savedStateHandle = handle,
            )
        }
        initializer {
            // Scoped to the chart, which is where a relation is now both asked and answered.
            val handle: SavedStateHandle = createSavedStateHandle()
            val route = handle.toRoute<TreeRoute>()
            RelationViewModel(repository(), handle, route.relateFrom, null)
        }
        initializer {
            val route = createSavedStateHandle().toRoute<AddRelativeRoute>()
            AddRelativeViewModel(repository(), route.anchorPersonId, route.kind)
        }
        initializer {
            val app = this[APPLICATION_KEY] as FTreeApplication
            val route = createSavedStateHandle().toRoute<BookRoute>()
            BookViewModel(
                exporter = app.container.exporter,
                repository = app.container.familyRepository,
                printer = app.container.bookPrinter,
                // One composer - one hidden WebView - per book screen, closed with it.
                composer = BookComposer(app),
                templates = app.container.bookTemplates,
                policy = app.container.entitlementPolicy,
                entitlements = app.container.entitlementSource,
                ledger = app.container.usageLedger,
                contentResolver = app.contentResolver,
                kinship = app.container.kinshipPreferences,
                scopePersonId = route.scopePersonId,
            )
        }
    }
}
