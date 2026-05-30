package com.threefat.vcts.ui.receipt

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.threefat.vcts.BuildConfig
import com.threefat.vcts.data.receipt.ReceiptAssetsLoader
import com.threefat.vcts.data.receipt.ReceiptHeaderInfo
import com.threefat.vcts.data.receipt.ReceiptPdfRenderer
import com.threefat.vcts.data.remote.dto.ReceiptAgentDto
import com.threefat.vcts.data.remote.dto.ReceiptTenantDto
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
    private val assetsLoader: ReceiptAssetsLoader,
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

    private var lastRenderedKey: String? = null

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

                    // Re-render whenever the receipt number or any attachment
                    // field changes (upload clears local path, sets url, etc.)
                    // so presigned URLs and the embedded PDF stay fresh.
                    val renderKey = collection?.let {
                        listOf(
                            it.receiptNo,
                            it.photoUrl,
                            it.signatureUrl,
                            it.photoLocalPath,
                            it.signatureLocalPath,
                        ).joinToString("|")
                    }

                    if (
                        collection != null &&
                        collection.syncStatus == SyncStatus.SYNCED &&
                        collection.receiptNo != null &&
                        renderKey != lastRenderedKey
                    ) {
                        lastRenderedKey = renderKey
                        _state.update { it.copy(isRenderingPdf = true) }

                        // Phase 10 / Track C1 - mirror the web template:
                        // pull branding + agent meta + presigned attachment
                        // URLs from the server, then resolve every embed
                        // (logo / photo / signature / map / QR) before
                        // handing the bytes to the renderer.
                        //
                        // Each step is best-effort: if the metadata call
                        // fails we fall back to slug-derived branding +
                        // session display name; if any single image fetch
                        // fails the renderer paints a "Not captured"
                        // placeholder for that slot.
                        val metadata = assetsLoader.fetchMetadata(collection.id)
                        val verifyUrl = metadata?.verifyUrl ?: deriveVerifyUrl(
                            tenantSlug = tenantSlug,
                            receiptNo = collection.receiptNo,
                        )
                        val embeds = assetsLoader.loadEmbeds(
                            collection = collection,
                            metadata = metadata,
                            verifyUrl = verifyUrl,
                        )

                        val sessionName = sessionStore.publicInfo.first()?.displayName
                        val header = ReceiptHeaderInfo(
                            tenant = metadata?.tenant ?: ReceiptTenantDto(
                                legalName = tenantDisplay(tenantSlug),
                            ),
                            agent = metadata?.agent ?: ReceiptAgentDto(name = sessionName),
                        )

                        val result = pdfRenderer.render(
                            collection = collection,
                            customer = customer,
                            tenantSlug = tenantSlug,
                            header = header,
                            embeds = embeds,
                            verifyUrl = verifyUrl,
                            reversed = metadata?.reversed ?: false,
                        )
                        _state.update {
                            it.copy(
                                isRenderingPdf = false,
                                pdfFile = result.getOrNull(),
                                pdfError = result.exceptionOrNull()?.message,
                                photoPresignedUrl = metadata?.photo?.url,
                                signaturePresignedUrl = metadata?.signature?.url,
                            )
                        }
                    }
                }
        }
    }

    private fun deriveVerifyUrl(tenantSlug: String, receiptNo: String): String {
        val path = receiptNo.split('/').joinToString("/") {
            java.net.URLEncoder.encode(it, "UTF-8")
        }
        return "${BuildConfig.API_BASE_URL.trimEnd('/')}/r/$path"
    }

    private fun tenantDisplay(slug: String): String =
        slug.split('-', '_').joinToString(" ") { it.replaceFirstChar(Char::titlecase) }

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
    val photoPresignedUrl: String? = null,
    val signaturePresignedUrl: String? = null,
) {
    /**
     * Verification URL embedded in the share-sheet text. Only meaningful
     * once the receipt number is known (i.e. the row has synced).
     *
     * Receipt numbers carry slashes (e.g. `acme/A001/FY26/00042`); the web
     * route is `[...path]` so we just URL-encode each segment to match
     * `publicReceiptUrl()` on the server.
     */
    val verifyUrl: String?
        get() = collection?.receiptNo?.let { rn ->
            val path = rn.split('/').joinToString("/") { java.net.URLEncoder.encode(it, "UTF-8") }
            "${BuildConfig.API_BASE_URL.trimEnd('/')}/r/$path"
        }
}
