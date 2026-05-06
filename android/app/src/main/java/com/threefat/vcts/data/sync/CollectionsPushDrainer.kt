package com.threefat.vcts.data.sync

import com.threefat.vcts.data.local.dao.CollectionDao
import com.threefat.vcts.data.local.dao.SyncQueueDao
import com.threefat.vcts.data.local.entity.SyncQueueEntity
import com.threefat.vcts.data.remote.SyncApi
import com.threefat.vcts.data.remote.dto.CollectionCreateBody
import com.threefat.vcts.data.remote.dto.SyncPushOutcomeDto
import com.threefat.vcts.data.remote.dto.SyncPushRequest
import com.threefat.vcts.domain.sync.PushSummary
import com.threefat.vcts.domain.sync.SyncStatus
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.json.Json
import retrofit2.HttpException

/**
 * Drains the local `sync_queue` table in FIFO chunks against
 * `POST /api/sync/push`. Each call performs at most [BATCH_SIZE] rows;
 * the worker re-invokes us until the queue empties or every remaining
 * row is in a non-retryable state.
 *
 * Lifecycle of a row through this class:
 *   1. Worker calls [drainOnce]. We read up to BATCH_SIZE pending rows.
 *   2. Each row is flipped to `in_flight` (idempotent + visible in the
 *      queue UI).
 *   3. We POST the batch. The server returns one outcome per row.
 *   4. For each outcome we reconcile the local store:
 *        created / duplicate -> drop the queue row; rewrite the local
 *                                collection row with the server's id +
 *                                receipt number; status flips to SYNCED.
 *        rejected (4xx)      -> mark queue row FAILED with the server
 *                                error code; the local collection row's
 *                                sync_status flips to FAILED so the UI
 *                                can show it.
 *   5. On a transport error (IOException, 5xx) we revert all in-flight
 *      rows in the batch back to PENDING with the last error stamped on
 *      them. They'll be retried on the next worker run.
 */
@Singleton
class CollectionsPushDrainer @Inject constructor(
    private val syncApi: SyncApi,
    private val queueDao: SyncQueueDao,
    private val collectionDao: CollectionDao,
    private val json: Json,
) {

    /**
     * One drain pass. Returns the per-pass summary; callers decide
     * whether to re-invoke based on `summary.attempted` and the queue's
     * remaining size.
     */
    suspend fun drainOnce(): PushSummary {
        val pending = queueDao.nextBatch(BATCH_SIZE)
            .filter { it.payloadType == SyncQueueEntity.PAYLOAD_COLLECTION_CREATE }
        if (pending.isEmpty()) {
            return PushSummary(0, 0, 0, 0, 0, 0)
        }

        val now = System.currentTimeMillis()
        for (row in pending) {
            queueDao.markInFlight(row.clientUuid, now)
        }

        val records: List<CollectionCreateBody> = pending.map { row ->
            json.decodeFromString(CollectionCreateBody.serializer(), row.body)
        }

        val response = try {
            syncApi.push(SyncPushRequest(records = records))
        } catch (e: HttpException) {
            // Transport-level rejection of the whole batch (auth expired,
            // server 500, etc). Revert in-flight -> pending so we retry.
            revertToPending(
                pending,
                code = "http_${e.code()}",
                message = e.message(),
            )
            return PushSummary(
                attempted = pending.size,
                created = 0,
                duplicate = 0,
                rejected = 0,
                transientFailures = pending.size,
                supervisorReview = 0,
            )
        } catch (e: IOException) {
            revertToPending(pending, code = "network", message = e.message)
            return PushSummary(
                attempted = pending.size,
                created = 0,
                duplicate = 0,
                rejected = 0,
                transientFailures = pending.size,
                supervisorReview = 0,
            )
        }

        // Reconcile per-record outcomes.
        var created = 0
        var duplicate = 0
        var rejected = 0
        var supervisorReview = 0
        val outcomesByUuid = response.outcomes.associateBy { it.clientUuid }
        for (queued in pending) {
            val outcome = outcomesByUuid[queued.clientUuid]
            if (outcome == null) {
                // Server elided this record (shouldn't happen with our
                // contract, but be defensive). Treat as transient.
                queueDao.markPendingWithError(
                    queued.clientUuid,
                    System.currentTimeMillis(),
                    code = "missing_outcome",
                    message = "server omitted outcome for record",
                )
                continue
            }
            when (outcome.status) {
                "created", "duplicate" -> {
                    if (outcome.status == "created") {
                        created += 1
                        if (outcome.supervisorReview) supervisorReview += 1
                    } else {
                        duplicate += 1
                    }
                    promoteToSynced(queued.clientUuid, outcome)
                }
                "rejected" -> {
                    rejected += 1
                    queueDao.markFailed(
                        queued.clientUuid,
                        System.currentTimeMillis(),
                        code = outcome.error?.code,
                        message = outcome.error?.message,
                    )
                    collectionDao.updateSyncStatusByClientUuid(
                        queued.clientUuid,
                        SyncStatus.FAILED.wire,
                    )
                }
                else -> {
                    // Unknown status; treat as transient so the row gets
                    // another shot rather than being silently lost.
                    queueDao.markPendingWithError(
                        queued.clientUuid,
                        System.currentTimeMillis(),
                        code = "unknown_status",
                        message = outcome.status,
                    )
                }
            }
        }

        return PushSummary(
            attempted = pending.size,
            created = created,
            duplicate = duplicate,
            rejected = rejected,
            transientFailures = 0,
            supervisorReview = supervisorReview,
        )
    }

    /**
     * The queue PK is `clientUuid`, the local-collection PK is the
     * server-issued UUID. On promotion we delete the queue row and
     * rekey the local collection row to match the server.
     */
    private suspend fun promoteToSynced(
        clientUuid: String,
        outcome: SyncPushOutcomeDto,
    ) {
        val ref = outcome.collection ?: return
        val existing = collectionDao.findByClientUuid(clientUuid)
        val now = System.currentTimeMillis()
        if (existing != null) {
            // Rebuild the row with the server's id + receipt no, keep the
            // rest of the agent-supplied fields verbatim.
            val promoted = existing.copy(
                id = ref.id,
                receiptNo = ref.receiptNo,
                supervisorReview = outcome.supervisorReview,
                syncStatus = SyncStatus.SYNCED.wire,
                cachedAt = now,
            )
            collectionDao.replaceLocalWithServer(clientUuid, promoted)
        }
        queueDao.delete(clientUuid)
    }

    private suspend fun revertToPending(
        rows: List<SyncQueueEntity>,
        code: String?,
        message: String?,
    ) {
        val now = System.currentTimeMillis()
        for (row in rows) {
            queueDao.markPendingWithError(row.clientUuid, now, code, message)
        }
    }

    companion object {
        /** Mirrors the server's MAX_BATCH cap. */
        const val BATCH_SIZE = 50
    }
}
