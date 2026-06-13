package com.threefat.vcts.data.sync

import com.threefat.vcts.data.local.dao.SyncQueueDao
import com.threefat.vcts.data.local.entity.SyncQueueEntity
import com.threefat.vcts.data.remote.CmsApi
import com.threefat.vcts.data.remote.dto.CmsItemQueueBody
import com.threefat.vcts.domain.sync.PushSummary
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.json.Json
import retrofit2.HttpException

/**
 * Drains CMS integration responses queued as [SyncQueueEntity.PAYLOAD_CMS_ITEM_CREATE].
 * Each row POSTs to `/api/cms/items/{collection}`.
 */
@Singleton
class CmsPushDrainer @Inject constructor(
    private val cmsApi: CmsApi,
    private val queueDao: SyncQueueDao,
    private val json: Json,
) {

    suspend fun drainOnce(): PushSummary {
        val pending = queueDao.nextBatch(BATCH_SIZE, MAX_ATTEMPTS)
            .filter { it.payloadType == SyncQueueEntity.PAYLOAD_CMS_ITEM_CREATE }
        if (pending.isEmpty()) {
            return PushSummary(0, 0, 0, 0, 0, 0)
        }

        var created = 0
        var rejected = 0
        var transient = 0

        for (row in pending) {
            val now = System.currentTimeMillis()
            queueDao.markInFlight(row.clientUuid, now)
            val body = json.decodeFromString(CmsItemQueueBody.serializer(), row.body)
            val result = runCatching { cmsApi.createItem(body.collection, body.payload) }
            result.fold(
                onSuccess = {
                    queueDao.delete(row.clientUuid)
                    created += 1
                },
                onFailure = { err ->
                    when (err) {
                        is HttpException -> {
                            if (err.code() in 400..499) {
                                queueDao.markFailed(
                                    row.clientUuid,
                                    now,
                                    "http_${err.code()}",
                                    err.message(),
                                )
                                rejected += 1
                            } else {
                                queueDao.markPendingWithError(
                                    row.clientUuid,
                                    now,
                                    "http_${err.code()}",
                                    err.message(),
                                )
                                transient += 1
                            }
                        }
                        is IOException -> {
                            queueDao.markPendingWithError(
                                row.clientUuid,
                                now,
                                "network",
                                err.message,
                            )
                            transient += 1
                        }
                        else -> {
                            queueDao.markPendingWithError(
                                row.clientUuid,
                                now,
                                "unknown",
                                err.message,
                            )
                            transient += 1
                        }
                    }
                },
            )
            if (transient > 0) break
        }

        return PushSummary(
            attempted = pending.size,
            created = created,
            duplicate = 0,
            rejected = rejected,
            transientFailures = transient,
            supervisorReview = 0,
        )
    }

    private companion object {
        const val BATCH_SIZE = 5
        const val MAX_ATTEMPTS = 8
    }
}
