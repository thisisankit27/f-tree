package com.vibethroughcode.ftree.ui.tree

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vibethroughcode.ftree.data.FamilyRepository
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.graph.TreeLayout
import com.vibethroughcode.ftree.graph.TreeLayoutEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class TreeUiState(
    val layout: TreeLayout = TreeLayout(),
    val loading: Boolean = true,
    /** No people at all, as opposed to a focus that could not be resolved. */
    val treeIsEmpty: Boolean = false,
    val generationsUp: Int = DEFAULT_GENERATIONS,
    val generationsDown: Int = DEFAULT_GENERATIONS,
) {
    companion object {
        const val DEFAULT_GENERATIONS = 3
    }
}

class TreeViewModel(
    private val repository: FamilyRepository,
    private val savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val _uiState = MutableStateFlow(TreeUiState())
    val uiState: StateFlow<TreeUiState> = _uiState.asStateFlow()

    /**
     * Survives process death, so returning to the app puts you back where you were looking rather
     * than at whoever happens to sort first.
     */
    var focusId: String?
        get() = savedStateHandle[FOCUS_KEY]
        private set(value) { savedStateHandle[FOCUS_KEY] = value }

    /**
     * Everyone, keyed by id — used only by the import review, which has to show what each proposed
     * match would be merged into.
     */
    val allPeople: StateFlow<Map<String, Person>> = repository.observeAllPeople()
        .map { people -> people.associateBy { it.id } }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptyMap())

    init {
        refresh()
        // The chart is a projection of the whole graph, so any change anywhere can move it.
        viewModelScope.launch {
            repository.observePersonCount().collect { refresh() }
        }
    }

    fun focusOn(personId: String) {
        focusId = personId
        refresh()
    }

    fun showMoreGenerations() {
        _uiState.update {
            it.copy(generationsUp = it.generationsUp + 2, generationsDown = it.generationsDown + 2)
        }
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            val state = _uiState.value
            val anchor = resolveFocus()
            if (anchor == null) {
                _uiState.update { it.copy(loading = false, treeIsEmpty = true, layout = TreeLayout()) }
                return@launch
            }

            // Loading and laying out are both off the main thread; a large family should never
            // stutter the chart it is being drawn into.
            val layout = withContext(Dispatchers.Default) {
                val snapshot = repository.loadNeighbourhood(
                    focusId = anchor,
                    generationsUp = state.generationsUp,
                    generationsDown = state.generationsDown,
                )
                TreeLayoutEngine.layout(
                    snapshot = snapshot,
                    focusId = anchor,
                    generationsUp = state.generationsUp,
                    generationsDown = state.generationsDown,
                )
            }
            _uiState.update { it.copy(layout = layout, loading = false, treeIsEmpty = false) }
        }
    }

    /**
     * Falls back to the first person in the tree when nothing is focused, or when the focused
     * person has been deleted underneath us.
     */
    private suspend fun resolveFocus(): String? {
        val current = focusId
        if (current != null && repository.person(current) != null) return current
        val best = repository.mostConnectedPersonId()
        focusId = best
        return best
    }

    private companion object {
        const val FOCUS_KEY = "tree-focus"
    }
}
