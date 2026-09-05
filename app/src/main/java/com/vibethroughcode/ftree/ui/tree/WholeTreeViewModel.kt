package com.vibethroughcode.ftree.ui.tree

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vibethroughcode.ftree.data.FamilyRepository
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.graph.FamilySnapshot
import com.vibethroughcode.ftree.graph.WholeTreeLayout
import com.vibethroughcode.ftree.graph.WholeTreeLayoutEngine
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

/**
 * What the whole-tree chart shows, and what it says about itself.
 *
 * The counts are not decoration. "How many people are in here, and how many of them has nobody
 * connected to anything yet" is a question about the state of the record that the ego-centric chart
 * structurally cannot answer, because the people in the answer are the ones it never draws.
 */
data class WholeTreeUiState(
    val loading: Boolean = true,
    val layout: WholeTreeLayout = WholeTreeLayout(),
    val peopleCount: Int = 0,
    val familyCount: Int = 0,
    val unconnectedCount: Int = 0,
    val unnamedCount: Int = 0,
    val generations: Int = 0,
    /** True while [layout] holds one traced relation rather than the whole record. */
    val tracing: Boolean = false,
) {
    val isEmpty: Boolean get() = !loading && peopleCount == 0
}

class WholeTreeViewModel(private val repository: FamilyRepository) : ViewModel() {

    private val _selected = MutableStateFlow<Person?>(null)
    val selected: StateFlow<Person?> = _selected.asStateFlow()

    private val snapshot: StateFlow<FamilySnapshot> = repository.observeWholeGraph()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), FamilySnapshot.Empty)

    private val trace = MutableStateFlow<Set<String>>(emptySet())

    /**
     * The people on a relation being traced, or nothing.
     *
     * A traced line is drawn *on its own* rather than lit up inside the whole chart. Fading the
     * other hundred and forty people still leaves them on the page, and at the scale a whole
     * family needs, a faded hundred and forty is what the eye actually sees. The question was how
     * two people connect; the answer is those people and the ones holding the line together.
     */
    fun onTraceChanged(ids: List<String>) {
        trace.value = ids.toSet()
    }

    val uiState: StateFlow<WholeTreeUiState> = combine(snapshot, trace) { whole, traced ->
        val shown = if (traced.isEmpty()) whole else whole.restrictedTo(traced)
        // Laying out a few thousand people is not main-thread work.
        val layout = WholeTreeLayoutEngine.layout(shown)
        WholeTreeUiState(
            loading = false,
            layout = layout,
            // The counts describe the record, not the cutting of it currently on screen.
            peopleCount = whole.people.size,
            familyCount = layout.groups.count { !it.unconnected },
            unconnectedCount = layout.unconnectedCount,
            unnamedCount = whole.people.values.count { it.isUnnamed },
            generations = layout.generations,
            tracing = traced.isNotEmpty(),
        )
    }
        .flowOn(Dispatchers.Default)
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), WholeTreeUiState())

    /**
     * Everyone one step from the selected person.
     *
     * The chart draws these at full strength and fades the rest, which is what makes a single
     * person findable among hundreds without hiding the context they sit in.
     */
    val highlighted: StateFlow<Set<String>> = combine(_selected, snapshot) { person, snapshot ->
        val id = person?.id ?: return@combine emptySet()
        buildSet {
            add(id)
            addAll(snapshot.parentsOf[id].orEmpty())
            addAll(snapshot.childrenOf[id].orEmpty())
            addAll(snapshot.spousesOf[id].orEmpty())
            addAll(snapshot.siblingsOf[id].orEmpty())
        }
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), emptySet())

    fun select(person: Person?) {
        _selected.value = person
    }
}
