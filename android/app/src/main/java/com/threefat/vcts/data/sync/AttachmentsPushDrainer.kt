package com.threefat.vcts.data.sync

import com.threefat.vcts.data.local.dao.CollectionDao
import com.threefat.vcts.data.remote.AttachmentsApi
import com.threefat.vcts.data.remote.dto.AttachmentAttachRequest
import com.threefat.vcts.data.remote.dto.AttachmentPresignRequest
import com.threefat.vcts.di.R2UploadClient
import com.threefat.vcts.domain.sync.AttachmentPushSummary
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody

/**
 * Phase 8 - upload drainer for capture attachments.
 *
 * The collection write path captures the photo + signature locally and
 * stamps the file paths onto the optimistic `collections` row. Once the
 * row syncs (we have a server id), this drainer:
 *
 *   1. Calls `POST /api/collections/{id}/attachments/presign` for each
 *      pending attachment.
 *   2. PUTs the bytes directly to R2 using the returned URL. Bypassing
 *      the Next.js function avoids the 4.5 MB body limit and keeps R2
 *      egress traffic cheap.
 *   3. PATCHes `/api/collections/{id}/attachments` with the resulting
 *      key so the server row carries `photo_url` / `signature_url`.
 *   4. Clears the local path on success and deletes the cache file.
 *
 * Failures are silent and idempotent: a transient network blip leaves
 * the local path in place; the next worker tick retries from where we
 * left off. Any 4xx (e.g. presign 403 because the user is no longer
 * the owner) gives up *for that collection* but doesn't poison the
 * queue - we never touch the local file in that case so the next agent
 * who manages to log in can clear the row manually if needed.
 */
@Singleton
class AttachmentsPushDrainer @Inject constructor(
    private val collectionDao: CollectionDao,
    private val attachmentsApi: AttachmentsApi,
    @R2UploadClient private val httpClient: OkHttpClient,
) {

    suspend fun drainOnce(): AttachmentPushSummary {
        val rows = collectionDao.nextAttachmentBatch(BATCH_SIZE)
        if (rows.isEmpty()) {
            return AttachmentPushSummary(
                attempted = 0,
                uploaded = 0,
                transientFailures = 0,
            )
        }

        var attempted = 0
        var uploaded = 0
        var transient = 0

        for (row in rows) {
            // Skip rows whose server id is still the clientUuid. Without
            // a server-issued id the presign endpoint will 404. The push
            // drainer will rekey the row first, so we just wait it out.
            if (row.id == row.clientUuid) continue

            val photoLocal = row.photoLocalPath?.let(::File)?.takeIf { it.exists() }
            val signatureLocal =
                row.signatureLocalPath?.let(::File)?.takeIf { it.exists() }

            if (photoLocal != null) {
                attempted += 1
                val outcome = uploadOne(
                    collectionId = row.id,
                    file = photoLocal,
                    kind = "photo",
                    contentType = "image/jpeg",
                )
                when (outcome) {
                    is UploadOutcome.Success -> {
                        collectionDao.finalisePhotoUpload(row.id, outcome.key)
                        runCatching { photoLocal.delete() }
                        uploaded += 1
                    }
                    UploadOutcome.Transient -> transient += 1
                    UploadOutcome.Permanent -> {
                        // Drop the local pointer so we stop hammering;
                        // we keep the file on disk in case a future
                        // recovery flow wants to re-attach it.
                        collectionDao.updateLocalAttachmentPaths(
                            id = row.id,
                            photoLocalPath = null,
                            signatureLocalPath = row.signatureLocalPath,
                        )
                    }
                }
            }

            if (signatureLocal != null) {
                attempted += 1
                val outcome = uploadOne(
                    collectionId = row.id,
                    file = signatureLocal,
                    kind = "signature",
                    contentType = "image/png",
                )
                when (outcome) {
                    is UploadOutcome.Success -> {
                        collectionDao.finaliseSignatureUpload(row.id, outcome.key)
                        runCatching { signatureLocal.delete() }
                        uploaded += 1
                    }
                    UploadOutcome.Transient -> transient += 1
                    UploadOutcome.Permanent -> {
                        collectionDao.updateLocalAttachmentPaths(
                            id = row.id,
                            photoLocalPath = row.photoLocalPath,
                            signatureLocalPath = null,
                        )
                    }
                }
            }
        }

        return AttachmentPushSummary(
            attempted = attempted,
            uploaded = uploaded,
            transientFailures = transient,
        )
    }

    private suspend fun uploadOne(
        collectionId: String,
        file: File,
        kind: String,
        contentType: String,
    ): UploadOutcome {
        // Step 1 - presign
        val presign = try {
            attachmentsApi.presign(
                collectionId = collectionId,
                body = AttachmentPresignRequest(kind = kind, contentType = contentType),
            )
        } catch (t: Throwable) {
            return classify(t)
        }

        // Step 2 - PUT to R2
        val request = Request.Builder()
            .url(presign.url)
            .put(file.asRequestBody(contentType.toMediaType()))
            .apply {
                presign.headers.forEach { (k, v) -> header(k, v) }
            }
            .build()
        val ok = try {
            httpClient.newCall(request).execute().use { it.isSuccessful }
        } catch (_: Throwable) {
            false
        }
        if (!ok) return UploadOutcome.Transient

        // Step 3 - attach
        val attachBody = when (kind) {
            "photo" -> AttachmentAttachRequest(photoUrl = presign.key)
            "signature" -> AttachmentAttachRequest(signatureUrl = presign.key)
            else -> AttachmentAttachRequest()
        }
        return try {
            attachmentsApi.attach(collectionId = collectionId, body = attachBody)
            UploadOutcome.Success(presign.key)
        } catch (t: Throwable) {
            classify(t)
        }
    }

    private fun classify(t: Throwable): UploadOutcome {
        // retrofit2.HttpException carries a `code()` member; use reflection
        // so we don't have to drag that import into the sync module just
        // to keep this branch tidy.
        val code = (t as? retrofit2.HttpException)?.code()
        return when {
            code != null && code in 400..499 && code != 408 && code != 429 ->
                UploadOutcome.Permanent
            else -> UploadOutcome.Transient
        }
    }

    private sealed interface UploadOutcome {
        data class Success(val key: String) : UploadOutcome
        data object Transient : UploadOutcome
        data object Permanent : UploadOutcome
    }

    companion object {
        private const val BATCH_SIZE = 20
    }
}
