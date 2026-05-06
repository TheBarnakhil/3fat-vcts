package com.threefat.vcts.data.local.dao

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Upsert
import com.threefat.vcts.data.local.entity.CollectionEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface CollectionDao {

    @Query("SELECT * FROM collections ORDER BY collected_at DESC LIMIT :limit")
    fun observeRecent(limit: Int = 50): Flow<List<CollectionEntity>>

    @Query("SELECT * FROM collections WHERE id = :id LIMIT 1")
    fun observe(id: String): Flow<CollectionEntity?>

    /**
     * Phase 6: route arguments may carry either the server-issued id
     * (post-sync) or the clientUuid (still pending). Both PKs appear in
     * this table at different points in a row's lifetime, so the
     * receipt-preview screen observes by *either* and the query stays
     * stable across the queue's rekey.
     */
    @Query("SELECT * FROM collections WHERE id = :key OR client_uuid = :key LIMIT 1")
    fun observeByIdOrClientUuid(key: String): Flow<CollectionEntity?>

    @Query("SELECT * FROM collections WHERE id = :id LIMIT 1")
    suspend fun get(id: String): CollectionEntity?

    @Query("SELECT * FROM collections WHERE client_uuid = :clientUuid LIMIT 1")
    suspend fun findByClientUuid(clientUuid: String): CollectionEntity?

    @Upsert
    suspend fun upsert(row: CollectionEntity)

    /**
     * Replace an optimistic (pending) row keyed by `clientUuid` with the
     * authoritative server row. We delete-then-insert under one transaction
     * because the PK changes (clientUuid → server id), and Room's [Upsert]
     * cannot rekey a row.
     */
    @androidx.room.Transaction
    suspend fun replaceLocalWithServer(
        clientUuid: String,
        server: CollectionEntity,
    ) {
        deleteByClientUuid(clientUuid)
        upsert(server)
    }

    @Query("DELETE FROM collections WHERE client_uuid = :clientUuid")
    suspend fun deleteByClientUuid(clientUuid: String)

    @Query(
        """
        UPDATE collections
        SET sync_status = :status
        WHERE client_uuid = :clientUuid
        """,
    )
    suspend fun updateSyncStatusByClientUuid(clientUuid: String, status: String)

    @Query("DELETE FROM collections")
    suspend fun clear()
}
