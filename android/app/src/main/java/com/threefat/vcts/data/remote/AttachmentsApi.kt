package com.threefat.vcts.data.remote

import com.threefat.vcts.data.remote.dto.AttachmentAttachRequest
import com.threefat.vcts.data.remote.dto.AttachmentAttachResponse
import com.threefat.vcts.data.remote.dto.AttachmentPresignRequest
import com.threefat.vcts.data.remote.dto.AttachmentPresignResponse
import retrofit2.http.Body
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path

/**
 * Phase 8 attachment endpoints. The actual upload of bytes goes
 * directly to Cloudflare R2 via the presigned URL we receive from
 * [presign]; only the metadata calls flow through our backend.
 */
interface AttachmentsApi {

    @POST("/api/collections/{id}/attachments/presign")
    suspend fun presign(
        @Path("id") collectionId: String,
        @Body body: AttachmentPresignRequest,
    ): AttachmentPresignResponse

    @PATCH("/api/collections/{id}/attachments")
    suspend fun attach(
        @Path("id") collectionId: String,
        @Body body: AttachmentAttachRequest,
    ): AttachmentAttachResponse
}
