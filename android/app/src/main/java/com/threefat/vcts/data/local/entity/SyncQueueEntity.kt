package com.threefat.vcts.data.local.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * Pending mutation waiting to flush to the server. Phase 6 only writes
 * collection submissions here, but the table is intentionally generic so
 * Phase 7 (location logs) and Phase 8 (photo / signature uploads) can ride
 * the same drain pipeline by using a different [payloadType].
 *
 * Idempotency is a property of the *payload*, not of this row: the
 * collection-submission body already carries a `clientUuid` that the
 * backend deduplicates on. We use that same UUID as our PK so a retry
 * collapses against the existing queue row instead of producing a
 * duplicate.
 *
 * [body] is the serialized JSON the worker will POST as-is. Storing the
 * frozen payload (rather than just a foreign key into `collections`) means
 * a later schema migration of the local Room DB cannot accidentally mutate
 * the bytes a server has already partially accepted.
 */
@Entity(
    tableName = "sync_queue",
    indices = [
        Index(value = ["status", "enqueued_at"]),
    ],
)
data class SyncQueueEntity(
    /** Idempotency key. For collections this is the `clientUuid`. */
    @PrimaryKey @ColumnInfo(name = "client_uuid") val clientUuid: String,
    @ColumnInfo(name = "payload_type") val payloadType: String,
    @ColumnInfo(name = "body") val body: String,
    @ColumnInfo(name = "status") val status: String,
    @ColumnInfo(name = "attempts") val attempts: Int,
    @ColumnInfo(name = "last_error_code") val lastErrorCode: String?,
    @ColumnInfo(name = "last_error_message") val lastErrorMessage: String?,
    @ColumnInfo(name = "enqueued_at") val enqueuedAt: Long,
    @ColumnInfo(name = "last_tried_at") val lastTriedAt: Long?,
) {
    companion object {
        const val PAYLOAD_COLLECTION_CREATE = "collection.create"
        const val PAYLOAD_CMS_ITEM_CREATE = "cms.item.create"
    }
}
