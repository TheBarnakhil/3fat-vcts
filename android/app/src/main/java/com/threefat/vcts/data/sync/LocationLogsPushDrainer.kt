package com.threefat.vcts.data.sync

import com.threefat.vcts.data.local.dao.LocationLogDao
import com.threefat.vcts.data.local.entity.LocationLogEntity
import com.threefat.vcts.data.remote.LocationLogsApi
import com.threefat.vcts.data.remote.dto.LocationLogBody
import com.threefat.vcts.data.remote.dto.LocationLogsBatchRequest
import com.threefat.vcts.domain.sync.LocationPushSummary
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton
import retrofit2.HttpException

/**
 * Drains queued tracker fixes against `/api/location-logs/batch`.
 *
 * Compared to [CollectionsPushDrainer] this is much simpler:
 *   - There's no per-row error reconciliation. Every server-acknowledged
 *     row (created OR duplicate) flips to `synced`.
 *   - Transport failures revert the whole batch by leaving rows as
 *     `pending` - we simply don't update anything.
 *   - We trim acknowledged rows older than [PRUNE_AFTER_MILLIS] so the
 *     local DB doesn't grow unbounded. The server is the source of
 *     truth for replay; we only keep recent acked fixes for debugging.
 */
@Singleton
class LocationLogsPushDrainer @Inject constructor(
    private val api: LocationLogsApi,
    private val dao: LocationLogDao,
) {

    suspend fun drainOnce(): LocationPushSummary {
        val pending = dao.nextBatch(BATCH_SIZE)
        if (pending.isEmpty()) {
            // Even if nothing to push, prune any synced rows that have
            // aged past the local retention window so we don't keep a
            // forever-growing table on devices that never sign out.
            val pruned = dao.deleteSyncedOlderThan(now() - PRUNE_AFTER_MILLIS)
            return LocationPushSummary(0, 0, 0, pruned)
        }

        val request = LocationLogsBatchRequest(
            logs = pending.map { it.toBody() },
        )

        val response = try {
            api.pushBatch(request)
        } catch (e: HttpException) {
            android.util.Log.w(TAG, "push http_${e.code()} - leaving pending", e)
            return LocationPushSummary(
                attempted = pending.size,
                acknowledged = 0,
                transientFailures = pending.size,
                pruned = 0,
            )
        } catch (e: IOException) {
            android.util.Log.w(TAG, "push network failure - leaving pending", e)
            return LocationPushSummary(
                attempted = pending.size,
                acknowledged = 0,
                transientFailures = pending.size,
                pruned = 0,
            )
        }

        // Both "created" and "duplicate" outcomes mean the server has
        // the row; we never need to retry them. Anything *not* in the
        // response is a contract violation - leave it pending so the
        // next round picks it up again.
        val acked = response.outcomes.map { it.clientUuid }
        if (acked.isNotEmpty()) {
            dao.markSynced(acked)
        }
        val pruned = dao.deleteSyncedOlderThan(now() - PRUNE_AFTER_MILLIS)

        return LocationPushSummary(
            attempted = pending.size,
            acknowledged = acked.size,
            transientFailures = 0,
            pruned = pruned,
        )
    }

    private fun LocationLogEntity.toBody(): LocationLogBody = LocationLogBody(
        clientUuid = clientUuid,
        lat = lat,
        lng = lng,
        accuracyM = accuracyM,
        batteryPct = batteryPct,
        loggedAt = loggedAt,
        source = source,
    )

    private fun now(): Long = System.currentTimeMillis()

    companion object {
        private const val TAG = "LocLogsDrainer"
        const val BATCH_SIZE = 100

        /**
         * Keep acked tracker fixes around for one day so the engineer
         * debugging "why did this happen at 3pm" still has the local
         * table to look at. After that they're dropped because the
         * server holds the canonical record.
         */
        const val PRUNE_AFTER_MILLIS = 24L * 60 * 60 * 1000
    }
}
