package com.threefat.vcts.ui.collection

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.threefat.vcts.data.location.LocationProvider
import com.threefat.vcts.data.remote.dto.CollectionCreateBody
import com.threefat.vcts.data.repository.CmsRepository
import com.threefat.vcts.data.repository.CollectionsRepository
import com.threefat.vcts.data.repository.CustomersRepository
import com.threefat.vcts.data.repository.IntegrationMode
import com.threefat.vcts.data.repository.SubmitCollectionFailure
import com.threefat.vcts.data.repository.SubmitCollectionOutcome
import com.threefat.vcts.domain.cms.JsonSchemaField
import com.threefat.vcts.domain.cms.buildJsonPayload
import com.threefat.vcts.domain.cms.parseJsonSchemaFields
import com.threefat.vcts.domain.cms.validateRequiredFields
import com.threefat.vcts.domain.geo.DEFAULT_GPS_MAX_ACCURACY_M
import com.threefat.vcts.domain.geo.geofenceStatus
import com.threefat.vcts.domain.model.Customer
import com.threefat.vcts.domain.model.PaymentMode
import com.threefat.vcts.ui.nav.Routes
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class CollectionFormViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val customersRepository: CustomersRepository,
    private val collectionsRepository: CollectionsRepository,
    private val cmsRepository: CmsRepository,
    private val locationProvider: LocationProvider,
) : ViewModel() {

    val customerId: String = checkNotNull(savedStateHandle[Routes.Collection.ArgCustomerId])

    /**
     * The idempotency key persists for the lifetime of the ViewModel so
     * a retry after a network blip uses the same UUID and the server
     * returns `replayed = true` instead of double-booking the collection.
     */
    private val clientUuid: String = collectionsRepository.newClientUuid()

    private val _state = MutableStateFlow(
        CollectionFormUiState(amountText = "", paymentMode = PaymentMode.Cash),
    )
    val state: StateFlow<CollectionFormUiState> = _state.asStateFlow()

    private val _events = Channel<CollectionFormEvent>(Channel.BUFFERED)
    val events = _events.receiveAsFlow()

    init {
        viewModelScope.launch {
            val customer = customersRepository.get(customerId)
            val integration = runCatching { cmsRepository.fetchIntegration() }.getOrNull()
            val cmsFields = if (
                integration?.mode == IntegrationMode.Offline &&
                integration.jsonSchema != null
            ) {
                parseJsonSchemaFields(integration.jsonSchema, integration.uiSchema)
            } else {
                emptyList()
            }
            _state.update {
                it.copy(
                    customer = customer,
                    integrationMode = integration?.mode ?: IntegrationMode.None,
                    webviewUrl = integration?.webviewUrl,
                    directusCollection = integration?.directusCollection,
                    cmsFields = cmsFields,
                )
            }
        }
    }

    fun onAmountChange(value: String) {
        // Allow only digits + at most one decimal separator.
        val sanitized = value.filterIndexed { _, c -> c.isDigit() || c == '.' }
            .let {
                val firstDot = it.indexOf('.')
                if (firstDot < 0) it else it.substring(0, firstDot + 1) +
                    it.substring(firstDot + 1).filter { ch -> ch.isDigit() }
            }
        _state.update { it.copy(amountText = sanitized, fieldError = null) }
    }

    fun onPaymentModeChange(mode: PaymentMode) {
        _state.update { it.copy(paymentMode = mode, fieldError = null) }
    }

    fun onRefNoChange(value: String) {
        _state.update { it.copy(refNo = value.take(64), fieldError = null) }
    }

    fun onChequeDateChange(value: String) {
        _state.update { it.copy(chequeDate = value.take(10), fieldError = null) }
    }

    fun onRemarksChange(value: String) {
        _state.update { it.copy(remarks = value.take(500)) }
    }

    fun onCmsFieldChange(key: String, value: String) {
        _state.update {
            it.copy(
                cmsValues = it.cmsValues + (key to value),
                cmsFieldError = null,
            )
        }
    }

    fun onOpenWebViewClick() {
        val url = state.value.webviewUrl ?: return
        viewModelScope.launch {
            _events.send(CollectionFormEvent.NavigateToWebView(url))
        }
    }

    fun onReviewClick() {
        val s = state.value
        val amount = s.amountText.toDoubleOrNull()
        val err = when {
            amount == null || amount <= 0 -> CollectionFieldError.AmountInvalid
            PaymentMode.requiresReference(s.paymentMode) && s.refNo.isNullOrBlank() ->
                CollectionFieldError.RefRequired
            s.integrationMode == IntegrationMode.Offline && s.cmsFields.isNotEmpty() -> {
                val missing = validateRequiredFields(s.cmsValues, s.cmsFields)
                if (missing != null) {
                    _state.update { it.copy(cmsFieldError = missing) }
                    return
                }
                null
            }
            else -> null
        }
        if (err != null) {
            _state.update { it.copy(fieldError = err) }
            return
        }
        _state.update { it.copy(showConfirm = true) }
    }

    fun onConfirmCancel() {
        _state.update { it.copy(showConfirm = false) }
    }

    fun onConfirmSubmit() {
        val s = state.value
        val amount = s.amountText.toDoubleOrNull() ?: return
        val customer = s.customer ?: return

        viewModelScope.launch {
            _state.update { it.copy(isSubmitting = true, showConfirm = false) }

            val fix = locationProvider.requestSingleFix()
            if (fix == null) {
                _state.update {
                    it.copy(
                        isSubmitting = false,
                        submissionError = CollectionSubmitError.LocationUnavailable(),
                    )
                }
                return@launch
            }

            // Re-check the geofence client-side; if the agent walked
            // outside between opening the form and tapping submit, fail
            // fast without burning a network round-trip.
            val gate = geofenceStatus(
                agentLat = fix.lat,
                agentLng = fix.lng,
                accuracyM = fix.accuracyM,
                customerLat = customer.lat,
                customerLng = customer.lng,
                allowedM = customer.geofenceRadiusM,
            )
            if (!gate.canCollect) {
                _state.update {
                    it.copy(
                        isSubmitting = false,
                        submissionError = if (!gate.insideFence) {
                            CollectionSubmitError.OutsideFence(
                                distanceM = gate.distanceM.toInt(),
                                allowedM = gate.allowedM,
                            )
                        } else {
                            CollectionSubmitError.GpsTooLow(
                                accuracyM = (gate.accuracyM ?: 0.0).toInt(),
                                allowedM = DEFAULT_GPS_MAX_ACCURACY_M.toInt(),
                            )
                        },
                    )
                }
                return@launch
            }

            val body = CollectionCreateBody(
                clientUuid = clientUuid,
                customerId = customer.id,
                amount = amount,
                paymentMode = s.paymentMode.wireValue,
                refNo = s.refNo?.takeIf { it.isNotBlank() },
                chequeDate = s.chequeDate?.takeIf { it.isNotBlank() && s.paymentMode == PaymentMode.Cheque },
                remarks = s.remarks?.takeIf { it.isNotBlank() },
                collectionLat = fix.lat,
                collectionLng = fix.lng,
                gpsAccuracyM = fix.accuracyM,
                // The drift detector on the server compares this against
                // the *current* server-side outstanding when the queue
                // eventually drains. Using the customer view we just
                // showed the agent guarantees we send what they saw.
                lastKnownOutstanding = customer.outstandingBalance,
            )

            when (val outcome = collectionsRepository.submit(body)) {
                is SubmitCollectionOutcome.Queued -> {
                    queueCmsResponseIfNeeded(s)
                    _state.update { it.copy(isSubmitting = false, submissionError = null) }
                    _events.send(
                        CollectionFormEvent.NavigateToReceipt(
                            collectionId = outcome.collection.id,
                            replayed = false,
                        ),
                    )
                }
                is SubmitCollectionOutcome.AlreadyQueued -> {
                    queueCmsResponseIfNeeded(s)
                    _state.update { it.copy(isSubmitting = false, submissionError = null) }
                    _events.send(
                        CollectionFormEvent.NavigateToReceipt(
                            collectionId = outcome.collection.id,
                            replayed = true,
                        ),
                    )
                }
                is SubmitCollectionOutcome.Failure -> {
                    _state.update {
                        it.copy(
                            isSubmitting = false,
                            submissionError = outcome.toUi(),
                        )
                    }
                }
            }
        }
    }

    fun onErrorDismissed() {
        _state.update { it.copy(submissionError = null) }
    }

    private suspend fun queueCmsResponseIfNeeded(state: CollectionFormUiState) {
        if (state.integrationMode != IntegrationMode.Offline) return
        val collection = state.directusCollection ?: return
        if (state.cmsFields.isEmpty()) return
        val payload = buildJsonPayload(state.cmsValues, state.cmsFields)
        cmsRepository.queueItemResponse(collection = collection, payload = payload)
    }

    private fun SubmitCollectionOutcome.Failure.toUi(): CollectionSubmitError = when (reason) {
        SubmitCollectionFailure.Validation -> CollectionSubmitError.Validation(message)
        // Storage failures usually mean the encrypted Room DB is gone or
        // the disk is full; surface them as a generic server-ish error
        // so the agent retries rather than thinking they hit a server bug.
        SubmitCollectionFailure.Storage,
        SubmitCollectionFailure.Unknown -> CollectionSubmitError.Server(message)
    }
}

data class CollectionFormUiState(
    val customer: Customer? = null,
    val amountText: String,
    val paymentMode: PaymentMode,
    val refNo: String? = null,
    val chequeDate: String? = null,
    val remarks: String? = null,
    val integrationMode: IntegrationMode = IntegrationMode.None,
    val webviewUrl: String? = null,
    val directusCollection: String? = null,
    val cmsFields: List<JsonSchemaField> = emptyList(),
    val cmsValues: Map<String, String> = emptyMap(),
    val cmsFieldError: String? = null,
    val isSubmitting: Boolean = false,
    val showConfirm: Boolean = false,
    val fieldError: CollectionFieldError? = null,
    val submissionError: CollectionSubmitError? = null,
)

enum class CollectionFieldError { AmountInvalid, RefRequired }

sealed interface CollectionSubmitError {
    data class OutsideFence(val distanceM: Int, val allowedM: Int, val serverMessage: String? = null) : CollectionSubmitError
    data class GpsTooLow(val accuracyM: Int, val allowedM: Int, val serverMessage: String? = null) : CollectionSubmitError
    data class RateLimited(val serverMessage: String? = null) : CollectionSubmitError
    data class Forbidden(val serverMessage: String? = null) : CollectionSubmitError
    data class Validation(val serverMessage: String? = null) : CollectionSubmitError
    data class Offline(val serverMessage: String? = null) : CollectionSubmitError
    data class Server(val serverMessage: String? = null) : CollectionSubmitError
    class LocationUnavailable : CollectionSubmitError
}

sealed interface CollectionFormEvent {
    data class NavigateToReceipt(val collectionId: String, val replayed: Boolean) : CollectionFormEvent
    data class NavigateToWebView(val url: String) : CollectionFormEvent
}

