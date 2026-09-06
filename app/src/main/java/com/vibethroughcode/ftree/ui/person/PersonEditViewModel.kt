package com.vibethroughcode.ftree.ui.person

import android.graphics.Bitmap
import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.vibethroughcode.ftree.data.FamilyRepository
import com.vibethroughcode.ftree.data.Gender
import com.vibethroughcode.ftree.data.PartialDate
import com.vibethroughcode.ftree.data.Person
import com.vibethroughcode.ftree.data.PhotoStore
import com.vibethroughcode.ftree.data.SquareCrop
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * A picked image on its way to becoming a portrait.
 *
 * Every photograph is framed before it is kept — there is no path that stores one uncropped — so
 * this is a step in picking a photo rather than an optional extra. The reason is that a face is
 * shown as a circle everywhere in this app, and letting the app choose the middle of somebody's
 * holiday snap is how you end up with a chart full of shoulders and hedges.
 */
sealed interface CropRequest {
    data object Loading : CropRequest
    data class Ready(val bitmap: Bitmap) : CropRequest
    data object Unreadable : CropRequest
}

/** Why a date the user typed cannot be saved. */
enum class DateProblem { MALFORMED, DEATH_BEFORE_BIRTH }

data class PersonEditUiState(
    val name: String = "",
    val gender: Gender = Gender.UNSPECIFIED,
    val birthDate: String = "",
    val deathDate: String = "",
    val deceased: Boolean = false,
    val notes: String = "",
    val photoId: String? = null,
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
    private val photos: PhotoStore,
    private val personId: String?,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {

    private val _uiState = MutableStateFlow(PersonEditUiState(isNew = personId == null))
    val uiState: StateFlow<PersonEditUiState> = _uiState.asStateFlow()

    private val _crop = MutableStateFlow<CropRequest?>(null)

    /** The photograph being framed, if one is. Null the rest of the time, which is most of it. */
    val crop: StateFlow<CropRequest?> = _crop.asStateFlow()

    /** The row being edited, kept so unedited fields (photo, timestamps, id) survive a save. */
    private var original: Person? = null

    /**
     * Photographs written while this form has been open.
     *
     * Framing three photographs and keeping the third writes three files; the two that lost are
     * cleaned up when the form is left, whichever way it is left. Deleting each one as the next
     * arrives would be simpler and wrong — backing out of the form must leave the person with the
     * picture they had.
     */
    private val written = mutableSetOf<String>()

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
                            photoId = person.photoId,
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

    /** Opens the picked image for framing. Nothing is written until the frame is confirmed. */
    fun onPhotoPicked(uri: Uri) {
        _crop.value = CropRequest.Loading
        viewModelScope.launch {
            val bitmap = photos.decodeForCrop(uri)
            _crop.value = if (bitmap == null) CropRequest.Unreadable else CropRequest.Ready(bitmap)
        }
    }

    fun onCropCancelled() {
        _crop.value = null
    }

    /** Writes the square the reader framed and hangs it on the form, not yet on the person. */
    fun onCropConfirmed(square: SquareCrop) {
        val ready = _crop.value as? CropRequest.Ready ?: return
        _crop.value = null
        viewModelScope.launch {
            val saved = photos.saveCrop(ready.bitmap, square) ?: return@launch
            written += saved
            _uiState.update { it.copy(photoId = saved, dirty = true) }
        }
    }

    fun onPhotoRemoved() {
        // The file is not deleted until the change is saved, so backing out leaves it intact.
        _uiState.update { it.copy(photoId = null, dirty = true) }
    }

    /** Leaving without saving: everything written while framing goes, the person keeps what they had. */
    fun onDiscarded() {
        val orphans = written.toList()
        written.clear()
        _crop.value = null
        viewModelScope.launch { orphans.forEach { photos.delete(it) } }
    }
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
                photoId = state.photoId,
                updatedAt = System.currentTimeMillis(),
            )
            if (original == null) repository.addPerson(updated) else repository.updatePerson(updated)

            // Only now is a discarded photo actually removed from disk: the one the person had if
            // it has been replaced, and every frame tried on the way to the one being kept.
            val removed = original?.photoId
            if (removed != null && removed != state.photoId) photos.delete(removed)
            written.filterNot { it == state.photoId }.forEach { photos.delete(it) }
            written.clear()

            onSaved(updated.id)
        }
    }
}
