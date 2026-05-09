package com.threefat.vcts.data.local.dao

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import com.threefat.vcts.data.local.entity.LocationLogEntity
import kotlinx.coroutines.flow.Flow

/**
 * Operations on the on-device `location_logs` table. Tracker fixes only;
 * collection-time spot fixes never enter this surface (they're embedded
 * in the collection record itself).
 */
@Dao
interface LocationLogDao {

    @Upsert
    suspend fun upsert(row: LocationLogEntity)

    @Upsert
    suspend fun upsertAll(rows: List<LocationLogEntity>)

    /**
     * Drain in time order so the server sees fixes in the same order
     * the device captured them. The compacted index `(sync_status,
     * logged_at)` makes this an index-range scan even with thousands
     * of synced rows still in the table.
     */
    @Query(
        """
        SELECT * FROM location_logs
        WHERE sync_status = 'pending'
        ORDER BY logged_at ASC
        LIMIT :limit
        """,
    )
    suspend fun nextBatch(limit: Int): List<LocationLogEntity>

    @Query(
        """
        UPDATE location_logs
        SET sync_status = 'synced'
        WHERE client_uuid IN (:clientUuids)
        """,
    )
    suspend fun markSynced(clientUuids: List<String>)

    /** Cap on-device storage by trimming successfully-synced fixes older than the cutoff. */
    @Query(
        """
        DELETE FROM location_logs
        WHERE sync_status = 'synced'
          AND enqueued_at < :olderThanEpochMillis
        """,
    )
    suspend fun deleteSyncedOlderThan(olderThanEpochMillis: Long): Int

    @Query("SELECT COUNT(*) FROM location_logs WHERE sync_status = 'pending'")
    fun observePendingCount(): Flow<Int>

    @Query("SELECT COUNT(*) FROM location_logs WHERE sync_status = 'pending'")
    suspend fun pendingCount(): Int

    @Query("DELETE FROM location_logs")
    suspend fun clear()
}
