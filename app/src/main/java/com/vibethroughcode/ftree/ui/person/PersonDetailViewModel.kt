package com.vibethroughcode.ftree.ui.person

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vibethroughcode.ftree.data.DeletionMode
import com.vibethroughcode.ftree.data.FamilyRepository
import com.vibethroughcode.ftree.data.Person
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class PersonDetailUiState(
    val person: Person? = null,
    val relationshipCount: Int = 0,
    val loaded: Boolean = false,
)

class PersonDetailViewModel(
    private val repository: FamilyRepository,
    val personId: String,
) : ViewModel() {

    private val relationshipCount = MutableStateFlow(0)

    val uiState: StateFlow<PersonDetailUiState> = combine(
        repository.observePerson(personId),
        repository.observeEdgesOf(personId).map { it.size },
    ) { person, edges ->
        PersonDetailUiState(person = person, relationshipCount = edges, loaded = true)
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = PersonDetailUiState(),
    )

    val edgeCount: StateFlow<Int> = relationshipCount.asStateFlow()

    /**
     * Deletion is a two-option decision rather than a yes/no, because losing one name should not
     * have to tear a hole in the family. The caller is told when the work is done so it can leave
     * the screen only after the row is actually gone.
     */
    fun delete(mode: DeletionMode, onDone: () -> Unit) {
        viewModelScope.launch {
            repository.deletePerson(personId, mode)
            onDone()
        }
    }
}
