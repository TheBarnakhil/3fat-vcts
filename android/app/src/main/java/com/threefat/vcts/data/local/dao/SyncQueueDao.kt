package com.threefat.vcts.data.local.dao

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import com.threefat.vcts.data.local.entity.SyncQueueEntity
import kotlinx.coroutines.flow.Flow

/**
 * Operations on the on-device `sync_queue` table.
 *
 * The drain order is FIFO by `enqueued_at`; we deliberately do NOT use a
 * separate priority column because the agent's mental model is "I made
 * three collections in this order, the receipts should sync in that order
 * too". Failed rows stay at the head until they're either retried
 * successfully or manually dismissed from the queue UI.
 */
@Dao
interface SyncQueueDao {

    /** Used by the queue screen + status badges. */
    @Query("SELECT * FROM sync_queue ORDER BY enqueued_at ASC")
    fun observeAll(): Flow<List<SyncQueueEntity>>

    /** Stream of just the rows that haven't synced yet, for header badges. */
    @Query(
        """
        SELECT * FROM sync_queue
        WHERE status IN ('pending', 'in_flight', 'failed')
        ORDER BY enqueued_at ASC
        """,
    )
    fun observePending(): Flow<List<SyncQueueEntity>>

    /** Workers grab a batch of drainable rows in FIFO order. */
    @Query(
        """
        SELECT * FROM sync_queue
        WHERE status IN ('pending', 'failed')
        ORDER BY enqueued_at ASC
        LIMIT :limit
        """,
    )
    suspend fun nextBatch(limit: Int): List<SyncQueueEntity>

    @Query("SELECT * FROM sync_queue WHERE client_uuid = :clientUuid LIMIT 1")
    suspend fun findByClientUuid(clientUuid: String): SyncQueueEntity?

    @Upsert
    suspend fun upsert(row: SyncQueueEntity)

    /**
     * Mark a row as currently being attempted. Atomic so the worker can
     * safely lease without taking a separate transaction.
     */
    @Query(
        """
        UPDATE sync_queue
        SET status = 'in_flight',
            last_tried_at = :now,
            attempts = attempts + 1
        WHERE client_uuid = :clientUuid
        """,
    )
    suspend fun markInFlight(clientUuid: String, now: Long)

    @Query(
        """
        UPDATE sync_queue
        SET status = 'pending',
            last_tried_at = :now,
            last_error_code = :code,
            last_error_message = :message
        WHERE client_uuid = :clientUuid
        """,
    )
    suspend fun markPendingWithError(
        clientUuid: String,
        now: Long,
        code: String?,
        message: String?,
    )

    @Query(
        """
        UPDATE sync_queue
        SET status = 'failed',
            last_tried_at = :now,
            last_error_code = :code,
            last_error_message = :message
        WHERE client_uuid = :clientUuid
        """,
    )
    suspend fun markFailed(
        clientUuid: String,
        now: Long,
        code: String?,
        message: String?,
    )

    @Query("DELETE FROM sync_queue WHERE client_uuid = :clientUuid")
    suspend fun delete(clientUuid: String)

    /**
     * Reset rows that the previous app process left mid-flight (e.g. a
     * crash). Called once at startup before WorkManager kicks the drain.
     */
    @Query(
        """
        UPDATE sync_queue
        SET status = 'pending'
        WHERE status = 'in_flight'
        """,
    )
    suspend fun resetInFlight()

    @Query("DELETE FROM sync_queue")
    suspend fun clear()

    @Query("SELECT COUNT(*) FROM sync_queue WHERE status IN ('pending', 'failed')")
    fun observePendingCount(): Flow<Int>
}
