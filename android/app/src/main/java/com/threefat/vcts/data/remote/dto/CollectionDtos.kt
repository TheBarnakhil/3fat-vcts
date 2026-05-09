package com.threefat.vcts.data.remote.dto

import kotlinx.serialization.Serializable

/**
 * Submission body for `POST /api/collections`. Matches the Zod schema in
 * `web/src/app/api/collections/route.ts`. The `clientUuid` is generated
 * on the device for idempotency - retrying the same submission is safe;
 * the server replies with `replayed: true` instead of inserting twice.
 *
 * Dates are sent as ISO-8601 strings so the server's `z.coerce.date()`
 * accepts them. We only send `collectedAt` if we actually backdated it;
 * the server defaults to `new Date()` when omitted.
 */
@Serializable
data class CollectionCreateBody(
    val clientUuid: String,
    val customerId: String,
    val amount: Double,
    val paymentMode: String,
    val refNo: String? = null,
    val chequeDate: String? = null,
    val remarks: String? = null,
    val collectionLat: Double,
    val collectionLng: Double,
    val gpsAccuracyM: Double? = null,
    val collectedAt: String? = null,
    val deviceId: String? = null,
    /**
     * Outstanding balance the device believed the customer had at submit
     * time. When the agent submits offline and the server's value has
     * drifted by > 10% by the time the queue drains, the server still
     * accepts the row but flags it for supervisor review (Phase 6).
     */
    val lastKnownOutstanding: Double? = null,
)

/**
 * Wraps the row the server inserts. We pluck the fields we actually use
 * on the receipt screen; anything else is forward-compatible thanks to
 * `ignoreUnknownKeys = true` in the Json singleton.
 */
@Serializable
data class CollectionRowDto(
    val id: String,
    val clientUuid: String? = null,
    val customerId: String,
    val agentId: String,
    val receiptNo: String,
    val amount: Double,
    val paymentMode: String,
    val refNo: String? = null,
    val chequeDate: String? = null,
    val remarks: String? = null,
    val collectionLat: Double,
    val collectionLng: Double,
    val gpsAccuracyM: Double? = null,
    val collectedAt: String,
    val supervisorReview: Boolean = false,
    /** Phase 8 - R2 keys (never absolute URLs) for capture proof. */
    val photoUrl: String? = null,
    val signatureUrl: String? = null,
)

@Serializable
data class CollectionCreateResponse(
    val collection: CollectionRowDto,
    val replayed: Boolean = false,
)
