package com.threefat.vcts.data.remote.dto

import kotlinx.serialization.Serializable

/**
 * Phase 8 - DTOs for the attachment upload pipeline.
 *
 * The flow is two-step:
 *   1. Device asks for a presigned PUT URL ([AttachmentPresignRequest])
 *   2. Device PUTs bytes to that URL via OkHttp
 *   3. Device PATCHes the collection row with the resulting key
 *      ([AttachmentAttachRequest]).
 */

@Serializable
data class AttachmentPresignRequest(
    val kind: String,
    val contentType: String,
)

@Serializable
data class AttachmentPresignResponse(
    val url: String,
    val key: String,
    val method: String = "PUT",
    val headers: Map<String, String> = emptyMap(),
)

@Serializable
data class AttachmentAttachRequest(
    val photoUrl: String? = null,
    val signatureUrl: String? = null,
)

@Serializable
data class AttachmentAttachResponse(
    val collection: AttachedCollection,
) {
    @Serializable
    data class AttachedCollection(
        val id: String,
        val photoUrl: String? = null,
        val signatureUrl: String? = null,
    )
}
