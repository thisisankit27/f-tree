package com.vibethroughcode.ftree.ui.relation

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vibethroughcode.ftree.data.FamilyRepository
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.graph.FamilySnapshot
import com.vibethroughcode.ftree.graph.Kinship
import com.vibethroughcode.ftree.graph.Relation
import com.vibethroughcode.ftree.graph.StepKind
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.stateIn

/** Which of the two slots a pick is filling. */
enum class RelationSlot { FROM, TO }

/** One person along the chain, with what they are to the person before them. */
data class ChainLink(val person: Person, val kind: StepKind)

data class RelationUiState(
    val loading: Boolean = true,
    val from: Person? = null,
    val to: Person? = null,
    val relation: Relation? = null,
    val chain: List<ChainLink> = emptyList(),
    val sharedAncestor: Person? = null,
    /** Everyone on the chain including both ends — what the chart lights up. */
    val trace: List<String> = emptyList(),
    /** Everyone matching the picker's search, name-ordered. */
    val candidates: List<Person> = emptyList(),
    /** The whole tree, which is a different question from how many the search matched. */
    val peopleCount: Int = 0,
) {
    val bothChosen: Boolean get() = from != null && to != null
    val treeIsEmpty: Boolean get() = !loading && peopleCount == 0
}

/**
 * Finding how two people are related.
 *
 * The whole graph is loaded once and both halves of the screen are served from it — the answer and
 * the picker. A relation is a question about the connections *between* people, so there is no
 * query that could return a useful subset: the search has to be able to reach anyone, and the
 * answer has to be free to walk anywhere.
 */
class RelationViewModel(
    repository: FamilyRepository,
    private val savedStateHandle: SavedStateHandle,
    initialFrom: String?,
    initialTo: String?,
) : ViewModel() {

    private val fromId = MutableStateFlow(savedStateHandle[FROM_KEY] ?: initialFrom)
    private val toId = MutableStateFlow(savedStateHandle[TO_KEY] ?: initialTo)

    private val query = MutableStateFlow("")
    val currentQuery: StateFlow<String> = query.asStateFlow()

    private val snapshot: StateFlow<FamilySnapshot> = repository.observeWholeGraph()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), FamilySnapshot.Empty)

    /**
     * The answer, recomputed only when the pair changes.
     *
     * Kept apart from the picker's list on purpose: relating two people walks the whole graph
     * twice, and folding the search box into the same combine would redo that on every keystroke.
     */
    private val answer = combine(snapshot, fromId, toId) { graph, from, to ->
        val relation = if (from != null && to != null) Kinship.relate(graph, from, to) else null
        val found = relation as? Relation.Found
        RelationUiState(
            loading = false,
            from = from?.let(graph.people::get),
            to = to?.let(graph.people::get),
            relation = relation,
            chain = found?.chain.orEmpty().mapNotNull { step ->
                graph.people[step.personId]?.let { ChainLink(it, step.kind) }
            },
            // Naming the ancestor is only worth a line when it is somebody else. "Through Ankit
            // Kumar, the nearest ancestor they share" is a true thing to say about Ankit and his
            // son, and a silly one.
            sharedAncestor = found?.sharedAncestorId
                ?.takeIf { it != from && it != to }
                ?.let(graph.people::get),
            trace = if (found != null && from != null) {
                found.peopleInvolved(from).toList()
            } else emptyList(),
            peopleCount = graph.people.size,
        )
    }

    private val candidates = combine(snapshot, query) { graph, text ->
        // Unnamed people sort last rather than first: they are placeholders, and a picker that
        // opens on a column of "Unknown" is no use to anybody.
        val ordered = graph.people.values.sortedWith(
            compareBy<Person> { it.name.isNullOrBlank() }
                .thenBy(String.CASE_INSENSITIVE_ORDER) { it.name.orEmpty() }
        )
        if (text.isBlank()) ordered
        else ordered.filter { it.name?.contains(text.trim(), ignoreCase = true) == true }
    }

    val uiState: StateFlow<RelationUiState> =
        combine(answer, candidates) { state, people -> state.copy(candidates = people) }
            // Both halves walk the whole tree; neither is main-thread work.
            .flowOn(Dispatchers.Default)
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), RelationUiState())

    fun choose(slot: RelationSlot, personId: String) {
        when (slot) {
            RelationSlot.FROM -> { fromId.value = personId; savedStateHandle[FROM_KEY] = personId }
            RelationSlot.TO -> { toId.value = personId; savedStateHandle[TO_KEY] = personId }
        }
        query.value = ""
    }

    /**
     * Turns the question round.
     *
     * "Who is Priya to me" and "who am I to Priya" are different questions with different words
     * for the answer — nephew one way, uncle the other — so swapping is worth a button.
     */
    fun swap() {
        val a = fromId.value
        fromId.value = toId.value
        toId.value = a
        savedStateHandle[FROM_KEY] = fromId.value
        savedStateHandle[TO_KEY] = toId.value
    }

    fun onQueryChange(value: String) {
        query.value = value
    }

    private companion object {
        const val FROM_KEY = "relation-from"
        const val TO_KEY = "relation-to"
    }
}
