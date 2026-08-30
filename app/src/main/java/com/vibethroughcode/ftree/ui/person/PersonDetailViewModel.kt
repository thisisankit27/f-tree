package com.vibethroughcode.ftree.ui.person

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vibethroughcode.ftree.data.DeletionMode
import com.vibethroughcode.ftree.data.FamilyRepository
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.data.RelativeKind
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class PersonDetailUiState(
    val person: Person? = null,
    val relationshipCount: Int = 0,
    val loaded: Boolean = false,
    val relatives: Map<RelativeKind, List<Person>> = emptyMap(),
) {
    fun of(kind: RelativeKind): List<Person> = relatives[kind].orEmpty()
}

class PersonDetailViewModel(
    private val repository: FamilyRepository,
    val personId: String,
) : ViewModel() {

    private val relatives = combine(
        repository.observeParents(personId),
        repository.observeSpouses(personId),
        repository.observeChildren(personId),
        repository.observeSiblings(personId),
    ) { parents, spouses, children, siblings ->
        mapOf(
            RelativeKind.PARENT to parents,
            RelativeKind.SPOUSE to spouses,
            RelativeKind.CHILD to children,
            RelativeKind.SIBLING to siblings,
        )
    }

    val uiState: StateFlow<PersonDetailUiState> = combine(
        repository.observePerson(personId),
        repository.observeEdgesOf(personId).map { it.size },
        relatives,
    ) { person, edges, related ->
        PersonDetailUiState(
            person = person,
            relationshipCount = edges,
            loaded = true,
            relatives = related,
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = PersonDetailUiState(),
    )

    /**
     * Removes one connection without touching either person. Both stay in the tree; only the
     * link between them goes.
     */
    fun removeRelationshipWith(otherPersonId: String) {
        viewModelScope.launch {
            repository.edgesBetween(personId, otherPersonId).forEach {
                repository.removeRelationship(it.id)
            }
        }
    }

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
