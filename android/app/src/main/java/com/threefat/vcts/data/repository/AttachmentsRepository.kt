package com.threefat.vcts.data.repository

import android.content.Context
import com.threefat.vcts.data.local.dao.CollectionDao
import com.threefat.vcts.sync.SyncScheduler
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.File
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 8 - manages on-device attachment buffers for a collection.
 *
 * The capture screens write the bytes to a tracked local file (via
 * [createPhotoSink] / [createSignatureSink]); once the agent confirms,
 * [attachLocally] stamps the path onto the collections row so the
 * [com.threefat.vcts.data.sync.AttachmentsPushDrainer] can replay the
 * presign + PUT + attach handshake the next time we have network.
 *
 * If the row is purely optimistic (the server has not issued an id
 * yet), the drainer simply skips it and tries again after the row
 * promotes from clientUuid to server id.
 */
@Singleton
class AttachmentsRepository @Inject constructor(
    @ApplicationContext private val context: Context,
    private val collectionDao: CollectionDao,
    private val syncScheduler: SyncScheduler,
) {

    /** Returns a fresh, empty file under cacheDir/photos/. */
    fun createPhotoSink(): File {
        val dir = File(context.cacheDir, "photos").apply { mkdirs() }
        return File(dir, "${UUID.randomUUID()}.jpg")
    }

    /** Returns a fresh, empty file under cacheDir/signatures/. */
    fun createSignatureSink(): File {
        val dir = File(context.cacheDir, "signatures").apply { mkdirs() }
        return File(dir, "${UUID.randomUUID()}.png")
    }

    /**
     * Records the captured files on the collection row. Either or both
     * may be null - "no change" semantics for the missing side. Returns
     * after the DB write so the receipt screen can re-read state.
     */
    suspend fun attachLocally(
        collectionKey: String,
        photoFile: File?,
        signatureFile: File?,
    ) {
        val current = collectionDao.observeByIdOrClientUuid(collectionKey)
        // observeByIdOrClientUuid is a Flow but we just need the snapshot;
        // round-trip via a one-shot lookup. The DAO already exposes one.
        val row = collectionDao.findByClientUuid(collectionKey)
            ?: collectionDao.get(collectionKey)
            ?: return
        val nextPhoto = photoFile?.absolutePath ?: row.photoLocalPath
        val nextSignature = signatureFile?.absolutePath ?: row.signatureLocalPath
        collectionDao.updateLocalAttachmentPaths(
            id = row.id,
            photoLocalPath = nextPhoto,
            signatureLocalPath = nextSignature,
        )
        // Avoid an unused-Flow lint warning; the call is intentional in
        // case future telemetry wants to read the current state without
        // adding a separate suspend method.
        @Suppress("UNUSED_VARIABLE")
        val keepAlive = current
        syncScheduler.requestImmediate()
    }
}
