package com.threefat.vcts.data.remote.dto

import kotlinx.serialization.Serializable

/**
 * Phase 10 / Track C1 - bundle of metadata + presigned GET URLs the
 * device needs to render a web-parity receipt PDF on-device. Anything
 * the device already has locally (collection fields) is intentionally
 * NOT duplicated here.
 *
 * Mirrors `web/src/app/api/collections/[id]/receipt-assets/route.ts`.
 */
@Serializable
data class ReceiptAssetsResponse(
    val collectionId: String,
    val receiptNo: String? = null,
    val reversed: Boolean = false,
    val verifyUrl: String? = null,
    val tenant: ReceiptTenantDto,
    val agent: ReceiptAgentDto,
    val photo: PresignedAssetDto? = null,
    val signature: PresignedAssetDto? = null,
    val logo: PresignedAssetDto? = null,
)

@Serializable
data class ReceiptTenantDto(
    val legalName: String,
    val address: String? = null,
    val gstin: String? = null,
    val phone: String? = null,
)

@Serializable
data class ReceiptAgentDto(
    val name: String? = null,
    val agentCode: String? = null,
)

@Serializable
data class PresignedAssetDto(
    val url: String,
    /** 0 means "this is a long-lived absolute URL, no need to refresh". */
    val expiresInSeconds: Int = 0,
    val mime: String,
)
