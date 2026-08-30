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
import com.vibethroughcode.ftree.ui.people.PeopleViewModel
import com.vibethroughcode.ftree.ui.person.PersonDetailViewModel
import com.vibethroughcode.ftree.ui.person.PersonEditViewModel
import com.vibethroughcode.ftree.ui.relative.AddRelativeViewModel

private fun CreationExtras.repository(): FamilyRepository =
    (this[APPLICATION_KEY] as FTreeApplication).container.familyRepository

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
            val handle: SavedStateHandle = createSavedStateHandle()
            PersonDetailViewModel(repository(), handle.toRoute<PersonRoute>().personId)
        }
        initializer {
            val handle: SavedStateHandle = createSavedStateHandle()
            PersonEditViewModel(repository(), handle.toRoute<EditPersonRoute>().personId, handle)
        }
        initializer {
            val route = createSavedStateHandle().toRoute<AddRelativeRoute>()
            AddRelativeViewModel(repository(), route.anchorPersonId, route.kind)
        }
    }
}
