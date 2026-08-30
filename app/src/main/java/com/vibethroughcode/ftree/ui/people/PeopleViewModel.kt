package com.vibethroughcode.ftree.ui.people

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vibethroughcode.ftree.data.FamilyRepository
import com.vibethroughcode.ftree.data.Person
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn

data class PeopleUiState(
    val people: List<Person> = emptyList(),
    val query: String = "",
    val loaded: Boolean = false,
) {
    val isEmptyTree: Boolean get() = loaded && people.isEmpty() && query.isBlank()
    val hasNoMatches: Boolean get() = loaded && people.isEmpty() && query.isNotBlank()
}

@OptIn(ExperimentalCoroutinesApi::class)
class PeopleViewModel(repository: FamilyRepository) : ViewModel() {

    private val query = MutableStateFlow("")
    val currentQuery: StateFlow<String> = query.asStateFlow()

    /**
     * The list is driven by the database rather than held in memory, and searching swaps the query
     * rather than filtering a loaded list, so a large tree never has to be materialised to find
     * one person.
     */
    private val results = query
        .debounce { if (it.isBlank()) 0L else 180L }
        .flatMapLatest { text ->
            if (text.isBlank()) repository.observeAllPeople() else repository.searchPeople(text)
        }

    val uiState: StateFlow<PeopleUiState> = combine(results, query) { people, text ->
        PeopleUiState(people = people, query = text, loaded = true)
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = PeopleUiState(),
    )

    fun onQueryChange(value: String) {
        query.value = value
    }
}
