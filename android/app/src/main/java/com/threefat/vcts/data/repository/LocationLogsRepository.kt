package com.threefat.vcts.data.repository

import com.threefat.vcts.data.local.dao.LocationLogDao
import com.threefat.vcts.data.local.entity.LocationLogEntity
import com.threefat.vcts.data.preferences.AppPreferences
import com.threefat.vcts.domain.sync.SyncStatus
import java.time.Instant
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow

/**
 * Phase 7: agent-side facade for the tracker pipeline. Keeps the
 * foreground service [com.threefat.vcts.tracking.LocationLoggerService]
 * decoupled from Room so the service stays small + testable.
 *
 * Workflow:
 *   1. Service captures a fix and calls [recordFix]; we generate a
 *      `clientUuid`, write a Room row keyed on it, and stamp
 *      `tracking_last_fix_at` so the dashboard can display "last seen".
 *   2. The next sync round (or the immediate per-fix push the service
 *      kicks off via `SyncScheduler.requestImmediate()`) drains the row
 *      to `/api/location-logs/batch`.
 */
@Singleton
class LocationLogsRepository @Inject constructor(
    private val dao: LocationLogDao,
    private val appPreferences: AppPreferences,
) {

    fun observePendingCount(): Flow<Int> = dao.observePendingCount()

    suspend fun pendingCount(): Int = dao.pendingCount()

    /**
     * Persist a fresh fix locally and update the "last fix" preference.
     * Returns the queued row's `clientUuid` for the caller's logs.
     */
    suspend fun recordFix(
        lat: Double,
        lng: Double,
        accuracyM: Double?,
        batteryPct: Int?,
        capturedAtMs: Long,
        source: String = "tracker",
    ): String {
        val clientUuid = UUID.randomUUID().toString()
        val row = LocationLogEntity(
            clientUuid = clientUuid,
            lat = lat,
            lng = lng,
            accuracyM = accuracyM,
            batteryPct = batteryPct,
            loggedAt = Instant.ofEpochMilli(capturedAtMs).toString(),
            source = source,
            syncStatus = SyncStatus.PENDING.wire,
            enqueuedAt = System.currentTimeMillis(),
        )
        dao.upsert(row)
        appPreferences.setTrackingLastFixAt(capturedAtMs)
        return clientUuid
    }

    suspend fun clear() {
        dao.clear()
    }
}
