package com.threefat.vcts.data.local.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * One queued GPS fix waiting to flush to `/api/location-logs/batch`.
 *
 * Phase 7 keeps tracker fixes in a *separate* table from `sync_queue`
 * because:
 *   - The batch surface area, retry policy, and idempotency model are
 *     fundamentally different (high-volume firehose vs. one-row-per-
 *     mutation queue with rich error reconciliation).
 *   - We never want a stuck tracker fix to block a collection submission
 *     from draining.
 *   - Per-row error tracking is overkill for tracker fixes - if a fix
 *     can't push, the next push attempt simply re-tries the whole batch.
 *
 * Idempotency is on `clientUuid`. The server's
 * `(tenant_id, agent_id, client_uuid)` unique index turns retries into
 * no-ops, so we mark every successful push (whether `created` or
 * `duplicate`) as synced.
 */
@Entity(
    tableName = "location_logs",
    indices = [
        Index(value = ["sync_status", "logged_at"]),
    ],
)
data class LocationLogEntity(
    @PrimaryKey @ColumnInfo(name = "client_uuid") val clientUuid: String,
    val lat: Double,
    val lng: Double,
    @ColumnInfo(name = "accuracy_m") val accuracyM: Double?,
    @ColumnInfo(name = "battery_pct") val batteryPct: Int?,
    /** ISO-8601 timestamp captured at fix time on the device. */
    @ColumnInfo(name = "logged_at") val loggedAt: String,
    /** Free-form source label - "tracker" today, future-proofed. */
    @ColumnInfo(name = "source", defaultValue = "tracker") val source: String,
    /**
     * Wire string from [com.threefat.vcts.domain.sync.SyncStatus]. Only
     * `pending` and `synced` are written here today; FAILED is reserved
     * for protocol-level rejections that we don't currently surface.
     */
    @ColumnInfo(name = "sync_status", defaultValue = "pending")
    val syncStatus: String,
    @ColumnInfo(name = "enqueued_at") val enqueuedAt: Long,
)
