package com.threefat.vcts.data.repository

import com.threefat.vcts.data.local.dao.CollectionDao
import com.threefat.vcts.data.local.dao.SyncQueueDao
import com.threefat.vcts.data.local.entity.CollectionEntity
import com.threefat.vcts.data.local.entity.SyncQueueEntity
import com.threefat.vcts.data.remote.dto.CollectionCreateBody
import com.threefat.vcts.domain.model.CollectionRecord
import com.threefat.vcts.domain.model.PaymentMode
import com.threefat.vcts.domain.sync.SyncStatus
import com.threefat.vcts.sync.SyncScheduler
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.Json

/**
 * Phase 6 turns this repository into an offline-first writer.
 *
 * `submit` no longer hits the network synchronously. It:
 *   1. Writes an optimistic [CollectionEntity] keyed by `clientUuid`
 *      with `sync_status = pending` so the receipt screen has something
 *      to render immediately.
 *   2. Decrements the customer's local outstanding balance.
 *   3. Inserts a row into `sync_queue`.
 *   4. Kicks the [SyncScheduler] to drain ASAP - if we're online the
 *      drain finishes before the receipt screen finishes its entrance
 *      animation; if we're offline the row simply waits in the queue.
 *
 * The receipt-preview screen reads from the same cache, so a successful
 * drain transparently flips the receipt number / sync badge once the
 * server replies. There is no second submit-button press.
 */
sealed interface SubmitCollectionOutcome {
    /**
     * The submission was accepted *locally* and queued for sync. The
     * backing record may still flip to FAILED if the eventual server
     * response is a 4xx; the queue UI surfaces that.
     */
    data class Queued(
        val collection: CollectionRecord,
    ) : SubmitCollectionOutcome

    /**
     * Idempotent replay of an already-submitted clientUuid. We treat
     * this exactly like a successful local queue insertion: the
     * background drain still runs and the local row already exists.
     */
    data class AlreadyQueued(
        val collection: CollectionRecord,
    ) : SubmitCollectionOutcome

    data class Failure(
        val reason: SubmitCollectionFailure,
        val message: String?,
    ) : SubmitCollectionOutcome
}

enum class SubmitCollectionFailure {
    Validation,
    Storage,
    Unknown,
}

@Singleton
class CollectionsRepository @Inject constructor(
    private val collectionDao: CollectionDao,
    private val queueDao: SyncQueueDao,
    private val customersRepository: CustomersRepository,
    private val syncScheduler: SyncScheduler,
    private val json: Json,
) {

    fun observeRecent(limit: Int = 50): Flow<List<CollectionRecord>> =
        collectionDao.observeRecent(limit).map { rows -> rows.map { it.toDomain() } }

    fun observe(id: String): Flow<CollectionRecord?> =
        collectionDao.observe(id).map { it?.toDomain() }

    /**
     * Resolves a collection by either the server-issued id or the
     * clientUuid. Useful for screens (receipt preview) whose route arg
     * may flip from a clientUuid (pending) to a server id once the
     * queue drains.
     */
    fun observeByKey(key: String): Flow<CollectionRecord?> =
        collectionDao.observeByIdOrClientUuid(key).map { it?.toDomain() }

    suspend fun get(id: String): CollectionRecord? = collectionDao.get(id)?.toDomain()

    suspend fun getByClientUuid(clientUuid: String): CollectionRecord? =
        collectionDao.findByClientUuid(clientUuid)?.toDomain()

    /**
     * Generates a fresh idempotency key. Callers should generate the key
     * up-front (in the form ViewModel) so a retry uses the same one.
     */
    fun newClientUuid(): String = UUID.randomUUID().toString()

    suspend fun submit(body: CollectionCreateBody): SubmitCollectionOutcome {
        return try {
            val now = System.currentTimeMillis()

            val existing = collectionDao.findByClientUuid(body.clientUuid)
            if (existing != null) {
                // Idempotent replay: the form was already submitted (e.g. user
                // double-tapped before the screen unmounted). Re-kick the
                // scheduler so the drain doesn't silently miss this row.
                syncScheduler.requestImmediate()
                return SubmitCollectionOutcome.AlreadyQueued(existing.toDomain())
            }

            val optimistic = CollectionEntity(
                id = body.clientUuid,
                clientUuid = body.clientUuid,
                customerId = body.customerId,
                agentId = "",
                receiptNo = null,
                amount = body.amount,
                paymentMode = body.paymentMode,
                refNo = body.refNo,
                chequeDate = body.chequeDate,
                remarks = body.remarks,
                collectionLat = body.collectionLat,
                collectionLng = body.collectionLng,
                gpsAccuracyM = body.gpsAccuracyM,
                collectedAt = body.collectedAt ?: java.time.Instant.now().toString(),
                supervisorReview = false,
                syncStatus = SyncStatus.PENDING.wire,
                cachedAt = now,
            )
            collectionDao.upsert(optimistic)

            // Local mirror of the outstanding-balance decrement so the
            // customer detail screen reflects the submission immediately.
            customersRepository.applyCollectionLocally(
                customerId = body.customerId,
                amount = body.amount,
            )

            val payload = json.encodeToString(CollectionCreateBody.serializer(), body)
            queueDao.upsert(
                SyncQueueEntity(
                    clientUuid = body.clientUuid,
                    payloadType = SyncQueueEntity.PAYLOAD_COLLECTION_CREATE,
                    body = payload,
                    status = SyncStatus.PENDING.wire,
                    attempts = 0,
                    lastErrorCode = null,
                    lastErrorMessage = null,
                    enqueuedAt = now,
                    lastTriedAt = null,
                ),
            )

            // Best-effort kick - WorkManager itself is responsible for the
            // actual constraints (network / backoff). Even if we're offline,
            // this is safe; the periodic worker + connectivity callback will
            // eventually pick the row up.
            syncScheduler.requestImmediate()

            SubmitCollectionOutcome.Queued(optimistic.toDomain())
        } catch (e: Throwable) {
            SubmitCollectionOutcome.Failure(SubmitCollectionFailure.Storage, e.message)
        }
    }

    /**
     * Manual retry for a single queue row from the offline-queue UI.
     * Just nudges the scheduler; the worker re-reads the queue itself.
     */
    fun retryAll() {
        syncScheduler.requestImmediate()
    }

    /**
     * Mirror helper for the [CollectionFormViewModel]: decide if a
     * payment mode requires a reference field. Re-exposed here so the
     * ViewModel doesn't need to know about [PaymentMode]'s static call
     * site - it can ask the repo about the request body it's building.
     */
    @Suppress("UNUSED_PARAMETER")
    fun requiresReference(mode: PaymentMode): Boolean =
        PaymentMode.requiresReference(mode)
}
