package com.threefat.vcts.ui.capture

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.threefat.vcts.data.repository.AttachmentsRepository
import com.threefat.vcts.ui.nav.Routes
import dagger.hilt.android.lifecycle.HiltViewModel
import java.io.File
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@HiltViewModel
class SignaturePadViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val attachmentsRepository: AttachmentsRepository,
) : ViewModel() {

    private val collectionId: String =
        checkNotNull(savedStateHandle[Routes.Capture.ArgCollectionId])

    private val _state = MutableStateFlow(SignaturePadUiState())
    val state: StateFlow<SignaturePadUiState> = _state.asStateFlow()

    fun signatureFile(): File = attachmentsRepository.createSignatureSink()

    fun persist(file: File) {
        _state.update { it.copy(isSaving = true, errorMessage = null) }
        viewModelScope.launch {
            attachmentsRepository.attachLocally(
                collectionKey = collectionId,
                photoFile = null,
                signatureFile = file,
            )
            _state.update { it.copy(isSaving = false, savedFile = file) }
        }
    }

    fun failPersist(message: String) {
        _state.update { it.copy(isSaving = false, errorMessage = message) }
    }
}

data class SignaturePadUiState(
    val isSaving: Boolean = false,
    val savedFile: File? = null,
    val errorMessage: String? = null,
)
