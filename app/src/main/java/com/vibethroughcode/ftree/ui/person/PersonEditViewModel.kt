package com.vibethroughcode.ftree.ui.person

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vibethroughcode.ftree.data.FamilyRepository
import com.vibethroughcode.ftree.data.Gender
import com.vibethroughcode.ftree.data.PartialDate
import com.vibethroughcode.ftree.data.Person
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** Why a date the user typed cannot be saved. */
enum class DateProblem { MALFORMED, DEATH_BEFORE_BIRTH }

data class PersonEditUiState(
    val name: String = "",
    val gender: Gender = Gender.UNSPECIFIED,
    val birthDate: String = "",
    val deathDate: String = "",
    val deceased: Boolean = false,
    val notes: String = "",
    val isNew: Boolean = true,
    val loaded: Boolean = false,
    val birthProblem: DateProblem? = null,
    val deathProblem: DateProblem? = null,
    val dirty: Boolean = false,
) {
    /**
     * Saving is blocked only by a date that cannot be understood. A completely blank form is
     * valid: it records a person whose details nobody knows yet.
     */
    val canSave: Boolean get() = birthProblem == null && deathProblem == null
}

class PersonEditViewModel(
    private val repository: FamilyRepository,
    private val personId: String?,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val _uiState = MutableStateFlow(PersonEditUiState(isNew = personId == null))
    val uiState: StateFlow<PersonEditUiState> = _uiState.asStateFlow()

    /** The row being edited, kept so unedited fields (photo, timestamps, id) survive a save. */
    private var original: Person? = null

    init {
        if (personId == null) {
            _uiState.update { it.copy(loaded = true) }
        } else {
            viewModelScope.launch {
                val person = repository.person(personId)
                original = person
                if (person != null) {
                    _uiState.update {
                        it.copy(
                            name = person.name.orEmpty(),
                            gender = person.gender,
                            birthDate = person.birthDate.orEmpty(),
                            deathDate = person.deathDate.orEmpty(),
                            deceased = person.deceased,
                            notes = person.notes.orEmpty(),
                            isNew = false,
                            loaded = true,
                        )
                    }
                } else {
                    _uiState.update { it.copy(loaded = true) }
                }
            }
        }
    }

    fun onNameChange(value: String) = _uiState.update { it.copy(name = value, dirty = true) }
    fun onGenderChange(value: Gender) = _uiState.update { it.copy(gender = value, dirty = true) }
    fun onNotesChange(value: String) = _uiState.update { it.copy(notes = value, dirty = true) }

    fun onDeceasedChange(value: Boolean) = _uiState.update {
        // Clearing "no longer living" would leave a death date stranded, so it goes with it.
        val next = it.copy(deceased = value, dirty = true, deathDate = if (value) it.deathDate else "")
        next.copy(deathProblem = validate(next).second)
    }

    fun onBirthDateChange(value: String) = _uiState.update {
        val next = it.copy(birthDate = value, dirty = true)
        val (birth, death) = validate(next)
        next.copy(birthProblem = birth, deathProblem = death)
    }

    fun onDeathDateChange(value: String) = _uiState.update {
        // Recording a death date says the person has died, so the switch follows the fact.
        val next = it.copy(deathDate = value, dirty = true, deceased = it.deceased || value.isNotBlank())
        val (birth, death) = validate(next)
        next.copy(birthProblem = birth, deathProblem = death)
    }

    private fun validate(state: PersonEditUiState): Pair<DateProblem?, DateProblem?> {
        val birthText = state.birthDate.trim()
        val deathText = state.deathDate.trim()
        val birth = PartialDate.parse(birthText)
        val death = PartialDate.parse(deathText)

        val birthProblem = if (birthText.isNotEmpty() && birth == null) DateProblem.MALFORMED else null
        var deathProblem = if (deathText.isNotEmpty() && death == null) DateProblem.MALFORMED else null

        // Only an impossible ordering counts; overlapping partial dates are left alone, because
        // "born 1938, died 1938" is a real thing to record.
        if (deathProblem == null && birth != null && death != null &&
            death.latest().isBefore(birth.earliest())
        ) {
            deathProblem = DateProblem.DEATH_BEFORE_BIRTH
        }
        return birthProblem to deathProblem
    }

    fun save(onSaved: (String) -> Unit) {
        val state = _uiState.value
        if (!state.canSave) return

        viewModelScope.launch {
            val base = original ?: Person()
            val updated = base.copy(
                name = state.name.trim().ifBlank { null },
                gender = state.gender,
                birthDate = state.birthDate.trim().ifBlank { null },
                deathDate = state.deathDate.trim().ifBlank { null },
                deceased = state.deceased,
                notes = state.notes.trim().ifBlank { null },
                updatedAt = System.currentTimeMillis(),
            )
            if (original == null) repository.addPerson(updated) else repository.updatePerson(updated)
            onSaved(updated.id)
        }
    }
}
