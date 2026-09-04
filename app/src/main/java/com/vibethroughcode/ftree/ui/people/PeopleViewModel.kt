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

/** Who the list is showing. */
enum class PeopleFilter { EVERYONE, LIVING }

data class PeopleUiState(
    val people: List<Person> = emptyList(),
    val query: String = "",
    val filter: PeopleFilter = PeopleFilter.EVERYONE,
    /** Before the filter, so the count line can say "of N in your tree". */
    val matchCount: Int = 0,
    val loaded: Boolean = false,
) {
    val isEmptyTree: Boolean get() = loaded && matchCount == 0 && query.isBlank()
    val hasNoMatches: Boolean get() = loaded && people.isEmpty() && query.isNotBlank()
    /** Everybody who matched is dead, which is a different thing from matching nothing. */
    val hasNoneLiving: Boolean
        get() = loaded && people.isEmpty() && matchCount > 0 && filter == PeopleFilter.LIVING
}

@OptIn(ExperimentalCoroutinesApi::class)
class PeopleViewModel(repository: FamilyRepository) : ViewModel() {

    private val query = MutableStateFlow("")
    val currentQuery: StateFlow<String> = query.asStateFlow()

    private val filter = MutableStateFlow(PeopleFilter.EVERYONE)

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

    /*
     * The filter is applied here rather than in SQL because the rows are already in hand for
     * display, and "no longer living" is a derived property — deceased or a death date — that
     * belongs with the rest of the domain rather than duplicated as a WHERE clause that could
     * drift from it.
     */
    val uiState: StateFlow<PeopleUiState> = combine(results, query, filter) { people, text, mode ->
        PeopleUiState(
            people = if (mode == PeopleFilter.LIVING) people.filterNot { it.isNoLongerLiving }
            else people,
            query = text,
            filter = mode,
            matchCount = people.size,
            loaded = true,
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = PeopleUiState(),
    )

    fun onQueryChange(value: String) {
        query.value = value
    }

    fun onFilterChange(value: PeopleFilter) {
        filter.value = value
    }
}
