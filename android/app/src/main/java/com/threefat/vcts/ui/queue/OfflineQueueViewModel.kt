package com.threefat.vcts.ui.queue

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.threefat.vcts.data.local.dao.CollectionDao
import com.threefat.vcts.data.local.dao.SyncQueueDao
import com.threefat.vcts.data.local.entity.SyncQueueEntity
import com.threefat.vcts.data.preferences.AppPreferences
import com.threefat.vcts.data.remote.dto.CmsItemQueueBody
import com.threefat.vcts.domain.sync.SyncStatus
import com.threefat.vcts.sync.SyncScheduler
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json

@HiltViewModel
class OfflineQueueViewModel @Inject constructor(
    private val queueDao: SyncQueueDao,
    private val collectionDao: CollectionDao,
    private val syncScheduler: SyncScheduler,
    private val json: Json,
    appPreferences: AppPreferences,
) : ViewModel() {

    val state: StateFlow<OfflineQueueUiState> = combine(
        queueDao.observeAll(),
        appPreferences.syncLastSuccessAt,
    ) { rows, lastSyncAt ->
        OfflineQueueUiState(
            rows = rows.map { it.toUiRow() },
            lastSyncAtEpochMillis = lastSyncAt,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), OfflineQueueUiState())

    fun onRetryAllClicked() {
        syncScheduler.requestImmediate()
    }

    fun onDiscardClicked(clientUuid: String, payloadType: String) {
        viewModelScope.launch {
            queueDao.delete(clientUuid)
            if (payloadType == SyncQueueEntity.PAYLOAD_COLLECTION_CREATE) {
                collectionDao.deleteByClientUuid(clientUuid)
            }
        }
    }

    private fun SyncQueueEntity.toUiRow(): OfflineQueueRow = OfflineQueueRow(
        clientUuid = clientUuid,
        payloadType = payloadType,
        cmsCollection = parseCmsCollection(payloadType, body),
        status = SyncStatus.fromWire(status),
        attempts = attempts,
        lastErrorCode = lastErrorCode,
        lastErrorMessage = lastErrorMessage,
        enqueuedAtEpochMillis = enqueuedAt,
        lastTriedAtEpochMillis = lastTriedAt,
        canDiscard = SyncStatus.fromWire(status) == SyncStatus.FAILED ||
            attempts >= MAX_ATTEMPTS,
    )

    private fun parseCmsCollection(payloadType: String, body: String): String? {
        if (payloadType != SyncQueueEntity.PAYLOAD_CMS_ITEM_CREATE) return null
        return runCatching {
            json.decodeFromString(CmsItemQueueBody.serializer(), body).collection
        }.getOrNull()
    }

    companion object {
        private const val MAX_ATTEMPTS = 10
    }
}

/**
 * UI-shaped projection. We deliberately strip the serialized body from
 * the DTO so a screen leak via screenshot can't reveal full submission
 * details.
 */
data class OfflineQueueUiState(
    val rows: List<OfflineQueueRow> = emptyList(),
    val lastSyncAtEpochMillis: Long? = null,
)

data class OfflineQueueRow(
    val clientUuid: String,
    val payloadType: String,
    val cmsCollection: String? = null,
    val status: SyncStatus,
    val attempts: Int,
    val lastErrorCode: String?,
    val lastErrorMessage: String?,
    val enqueuedAtEpochMillis: Long,
    val lastTriedAtEpochMillis: Long?,
    val canDiscard: Boolean,
)
