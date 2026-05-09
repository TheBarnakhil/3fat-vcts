package com.threefat.vcts.ui.capture

import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.threefat.vcts.data.repository.AttachmentsRepository
import com.threefat.vcts.ui.nav.Routes
import dagger.hilt.android.lifecycle.HiltViewModel
import java.io.File
import java.util.concurrent.Executor
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

@HiltViewModel
class PhotoCaptureViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val attachmentsRepository: AttachmentsRepository,
) : ViewModel() {

    private val collectionId: String =
        checkNotNull(savedStateHandle[Routes.Capture.ArgCollectionId])

    private val _state = MutableStateFlow(PhotoCaptureUiState())
    val state: StateFlow<PhotoCaptureUiState> = _state.asStateFlow()

    private var imageCapture: ImageCapture? = null

    fun bindImageCapture(capture: ImageCapture) {
        imageCapture = capture
    }

    fun captureFile(): File = attachmentsRepository.createPhotoSink()

    fun flipLens() {
        _state.update {
            it.copy(
                lensFacing = if (it.lensFacing == CameraSelector.LENS_FACING_BACK) {
                    CameraSelector.LENS_FACING_FRONT
                } else {
                    CameraSelector.LENS_FACING_BACK
                },
            )
        }
    }

    fun capture(executor: Executor, file: File, @Suppress("UNUSED_PARAMETER") lifecycleOwner: LifecycleOwner) {
        val ic = imageCapture ?: return
        _state.update { it.copy(isCapturing = true, errorMessage = null) }
        ic.takePictureSuspending(
            executor = executor,
            file = file,
            onError = { exc ->
                _state.update {
                    it.copy(
                        isCapturing = false,
                        errorMessage = exc.localizedMessage ?: "Capture failed",
                    )
                }
            },
            onSaved = { saved ->
                viewModelScope.launch {
                    attachmentsRepository.attachLocally(
                        collectionKey = collectionId,
                        photoFile = saved,
                        signatureFile = null,
                    )
                    _state.update { it.copy(isCapturing = false, savedFile = saved) }
                }
            },
        )
    }
}

data class PhotoCaptureUiState(
    val isCapturing: Boolean = false,
    val savedFile: File? = null,
    val errorMessage: String? = null,
    val lensFacing: Int = CameraSelector.LENS_FACING_BACK,
)
