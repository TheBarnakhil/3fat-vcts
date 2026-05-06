package com.threefat.vcts.data.local.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Local copy of a collection. Phase 6 onwards this table holds *both*:
 *   - rows that have been confirmed by the server (`sync_status = 'synced'`,
 *     id == server-issued UUID, receipt_no populated), and
 *   - optimistic rows queued offline (`sync_status` in pending/in_flight/
 *     failed; id == clientUuid until the server replies; receipt_no may be
 *     null until then).
 *
 * Storing the optimistic row here (rather than only in `sync_queue`) lets
 * the receipt-preview screen and customer ledger show the row immediately
 * after submit even when offline, without separate query paths.
 *
 * [clientUuid] is the idempotency key the device generates before
 * submission. On replay the server's `(tenant_id, client_uuid)` unique
 * index guarantees we never duplicate.
 */
@Entity(tableName = "collections")
data class CollectionEntity(
    @PrimaryKey val id: String,
    @ColumnInfo(name = "client_uuid") val clientUuid: String,
    @ColumnInfo(name = "customer_id") val customerId: String,
    @ColumnInfo(name = "agent_id") val agentId: String,
    @ColumnInfo(name = "receipt_no") val receiptNo: String?,
    val amount: Double,
    @ColumnInfo(name = "payment_mode") val paymentMode: String,
    @ColumnInfo(name = "ref_no") val refNo: String?,
    @ColumnInfo(name = "cheque_date") val chequeDate: String?,
    val remarks: String?,
    @ColumnInfo(name = "collection_lat") val collectionLat: Double,
    @ColumnInfo(name = "collection_lng") val collectionLng: Double,
    @ColumnInfo(name = "gps_accuracy_m") val gpsAccuracyM: Double?,
    @ColumnInfo(name = "collected_at") val collectedAt: String,
    @ColumnInfo(name = "supervisor_review") val supervisorReview: Boolean,
    /**
     * Wire string from [com.threefat.vcts.domain.sync.SyncStatus]. Default
     * "synced" preserves Phase 5 semantics for any pre-existing rows that
     * survive a non-destructive migration.
     */
    @ColumnInfo(name = "sync_status", defaultValue = "synced")
    val syncStatus: String,
    @ColumnInfo(name = "cached_at") val cachedAt: Long,
)
