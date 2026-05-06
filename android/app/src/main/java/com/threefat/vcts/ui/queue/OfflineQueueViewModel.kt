package com.threefat.vcts.ui.queue

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.threefat.vcts.data.local.dao.SyncQueueDao
import com.threefat.vcts.data.local.entity.SyncQueueEntity
import com.threefat.vcts.data.preferences.AppPreferences
import com.threefat.vcts.domain.sync.SyncStatus
import com.threefat.vcts.sync.SyncScheduler
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

@HiltViewModel
class OfflineQueueViewModel @Inject constructor(
    private val queueDao: SyncQueueDao,
    private val syncScheduler: SyncScheduler,
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

    private fun SyncQueueEntity.toUiRow(): OfflineQueueRow = OfflineQueueRow(
        clientUuid = clientUuid,
        payloadType = payloadType,
        status = SyncStatus.fromWire(status),
        attempts = attempts,
        lastErrorCode = lastErrorCode,
        lastErrorMessage = lastErrorMessage,
        enqueuedAtEpochMillis = enqueuedAt,
        lastTriedAtEpochMillis = lastTriedAt,
    )
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
    val status: SyncStatus,
    val attempts: Int,
    val lastErrorCode: String?,
    val lastErrorMessage: String?,
    val enqueuedAtEpochMillis: Long,
    val lastTriedAtEpochMillis: Long?,
)
