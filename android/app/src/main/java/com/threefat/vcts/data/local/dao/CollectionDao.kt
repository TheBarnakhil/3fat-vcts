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
     *
     * Pending local attachment paths are carried over inside the same
     * transaction (read + write are atomic) so a capture/drainer write that
     * races a pull can't be clobbered. A path is preserved only while the
     * server has no uploaded key for that side; once the key lands the
     * upload is done and the local pointer is dropped.
     */
    @androidx.room.Transaction
    suspend fun replaceLocalWithServer(
        clientUuid: String,
        server: CollectionEntity,
    ) {
        val existing = findByClientUuid(clientUuid)
        deleteByClientUuid(clientUuid)
        upsert(server.mergeLocalPathsFrom(existing))
    }

    /**
     * Upsert an authoritative server row while atomically carrying over any
     * pending local attachment paths from the row it replaces. Use this
     * instead of [upsert] on the pull path so a concurrent capture/drainer
     * write isn't lost to a stale read.
     */
    @androidx.room.Transaction
    suspend fun upsertPreservingLocalPaths(server: CollectionEntity) {
        val existing = get(server.id)
        upsert(server.mergeLocalPathsFrom(existing))
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

    /**
     * Phase 8: rows that have already synced server-side but still have
     * local-only photo / signature buffers waiting to be uploaded. Used
     * by [com.threefat.vcts.data.sync.AttachmentsPushDrainer].
     */
    @Query(
        """
        SELECT * FROM collections
        WHERE sync_status = 'synced'
          AND (photo_local_path IS NOT NULL OR signature_local_path IS NOT NULL)
        ORDER BY collected_at ASC
        LIMIT :limit
        """,
    )
    suspend fun nextAttachmentBatch(limit: Int): List<CollectionEntity>

    @Query(
        """
        UPDATE collections
        SET photo_url = :photoUrl,
            photo_local_path = NULL
        WHERE id = :id
        """,
    )
    suspend fun finalisePhotoUpload(id: String, photoUrl: String)

    @Query(
        """
        UPDATE collections
        SET signature_url = :signatureUrl,
            signature_local_path = NULL
        WHERE id = :id
        """,
    )
    suspend fun finaliseSignatureUpload(id: String, signatureUrl: String)

    @Query(
        """
        UPDATE collections
        SET photo_local_path = :photoLocalPath,
            signature_local_path = :signatureLocalPath
        WHERE id = :id OR client_uuid = :id
        """,
    )
    suspend fun updateLocalAttachmentPaths(
        id: String,
        photoLocalPath: String?,
        signatureLocalPath: String?,
    )

    @Query("SELECT COUNT(*) FROM collections WHERE photo_local_path IS NOT NULL OR signature_local_path IS NOT NULL")
    fun observePendingAttachmentCount(): Flow<Int>

    @Query("DELETE FROM collections")
    suspend fun clear()
}

/**
 * Carry pending local attachment paths from a prior [existing] row onto an
 * authoritative server row, but only while the server still lacks an uploaded
 * key for that side. Keeps the upload-drainer's local pointers alive across a
 * pull that arrived before the upload finished.
 */
private fun CollectionEntity.mergeLocalPathsFrom(
    existing: CollectionEntity?,
): CollectionEntity = copy(
    photoLocalPath = if (photoUrl == null) existing?.photoLocalPath else null,
    signatureLocalPath = if (signatureUrl == null) existing?.signatureLocalPath else null,
)
