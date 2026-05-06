package com.threefat.vcts.ui.receipt

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.threefat.vcts.data.receipt.ReceiptPdfRenderer
import com.threefat.vcts.data.repository.CollectionsRepository
import com.threefat.vcts.data.repository.CustomersRepository
import com.threefat.vcts.data.session.SessionStore
import com.threefat.vcts.domain.model.CollectionRecord
import com.threefat.vcts.domain.model.Customer
import com.threefat.vcts.domain.sync.SyncStatus
import com.threefat.vcts.ui.nav.Routes
import dagger.hilt.android.lifecycle.HiltViewModel
import java.io.File
import javax.inject.Inject
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Phase 6 update: the receipt screen now observes the collection by id
 * and reacts when the queue drainer promotes the row from
 * `pending` -> `synced`. The PDF render is gated on receiptNo so we
 * never produce a "draft" PDF that doesn't match the server's eventual
 * receipt number.
 *
 * The route id is *either* a clientUuid (immediately after submit, while
 * the row is still pending) or a server-issued UUID (post-sync). Both
 * land in the same `collections` table; we look up by id, fall back to
 * clientUuid lookup if necessary so the screen survives the rekey.
 */
@HiltViewModel
class ReceiptPreviewViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val collectionsRepository: CollectionsRepository,
    private val customersRepository: CustomersRepository,
    private val sessionStore: SessionStore,
    private val pdfRenderer: ReceiptPdfRenderer,
) : ViewModel() {

    private val collectionId: String = checkNotNull(savedStateHandle[Routes.Receipt.ArgId])
    val replayed: Boolean = savedStateHandle[Routes.Receipt.ArgReplayed] ?: false

    private val _state = MutableStateFlow(ReceiptUiState(replayed = replayed))
    val state: StateFlow<ReceiptUiState> = _state.asStateFlow()

    /**
     * Live view of the underlying row. The key may be either a clientUuid
     * (the row is still queued) or a server id (the row has synced). The
     * DAO query handles both.
     */
    private val collectionFlow: StateFlow<CollectionRecord?> =
        collectionsRepository.observeByKey(collectionId)
            .distinctUntilChanged()
            .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private var lastRenderedReceiptNo: String? = null

    init {
        viewModelScope.launch {
            val tenantSlug = sessionStore.publicInfo.first()?.tenantSlug.orEmpty()
            _state.update { it.copy(tenantSlug = tenantSlug) }

            collectionFlow
                .collect { collection ->
                    val customer = collection?.let {
                        customersRepository.get(it.customerId)
                    }
                    _state.update {
                        it.copy(collection = collection, customer = customer)
                    }

                    // Render lazily, and only once per receipt-no flip.
                    if (
                        collection != null &&
                        collection.syncStatus == SyncStatus.SYNCED &&
                        collection.receiptNo != null &&
                        collection.receiptNo != lastRenderedReceiptNo
                    ) {
                        lastRenderedReceiptNo = collection.receiptNo
                        _state.update { it.copy(isRenderingPdf = true) }
                        val result = pdfRenderer.render(
                            collection = collection,
                            customer = customer,
                            tenantSlug = tenantSlug,
                        )
                        _state.update {
                            it.copy(
                                isRenderingPdf = false,
                                pdfFile = result.getOrNull(),
                                pdfError = result.exceptionOrNull()?.message,
                            )
                        }
                    }
                }
        }
    }

    /** Called from the queue UI / banner to retry stuck rows manually. */
    fun retrySync() {
        collectionsRepository.retryAll()
    }
}

data class ReceiptUiState(
    val collection: CollectionRecord? = null,
    val customer: Customer? = null,
    val tenantSlug: String = "",
    val replayed: Boolean = false,
    val isRenderingPdf: Boolean = false,
    val pdfFile: File? = null,
    val pdfError: String? = null,
)
