package com.vibethroughcode.ftree.ui

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewmodel.CreationExtras
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.toRoute
import com.vibethroughcode.ftree.FTreeApplication
import com.vibethroughcode.ftree.data.FamilyRepository
import com.vibethroughcode.ftree.data.PhotoStore
import com.vibethroughcode.ftree.ui.people.PeopleViewModel
import com.vibethroughcode.ftree.ui.person.PersonDetailViewModel
import com.vibethroughcode.ftree.ui.person.PersonEditViewModel
import com.vibethroughcode.ftree.ui.relative.AddRelativeViewModel
import com.vibethroughcode.ftree.ui.transfer.TransferViewModel
import com.vibethroughcode.ftree.ui.tree.TreeViewModel

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
        initializer { TreeViewModel(repository(), createSavedStateHandle()) }
        initializer {
            val app = this[APPLICATION_KEY] as FTreeApplication
            TransferViewModel(app.container.exporter, app.contentResolver)
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
            val route = createSavedStateHandle().toRoute<AddRelativeRoute>()
            AddRelativeViewModel(repository(), route.anchorPersonId, route.kind)
        }
    }
}
