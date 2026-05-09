package com.threefat.vcts.data.remote.dto

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * Per-record error returned by `/sync/push`. Mirrors the server's
 * `{ code, message, details? }` shape verbatim. Distinct from
 * [ApiErrorBody] - the legacy auth/login DTO - because that one models
 * an envelope shape we never actually receive from the sync route.
 */
@Serializable
data class SyncRecordError(
    val code: String,
    val message: String? = null,
    val details: JsonElement? = null,
)

// ---------------------------------------------------------------------------
// /api/sync/push
// ---------------------------------------------------------------------------

@Serializable
data class SyncPushRequest(
    val records: List<CollectionCreateBody>,
)

@Serializable
data class SyncPushResponse(
    val outcomes: List<SyncPushOutcomeDto>,
    val counts: SyncPushCountsDto,
)

@Serializable
data class SyncPushCountsDto(
    val created: Int = 0,
    val duplicate: Int = 0,
    val rejected: Int = 0,
    val supervisorReview: Int = 0,
)

/**
 * One outcome per record in the request. Discriminated by [status]:
 *   - "created" / "duplicate" -> [collection] is set, [error] is null
 *   - "rejected"              -> [error] is set, [collection] is null
 *
 * We don't model this with sealed classes because Retrofit's
 * `kotlinx-serialization` converter doesn't auto-discriminate without
 * extra ceremony - keeping the shape flat keeps the client simple.
 */
@Serializable
data class SyncPushOutcomeDto(
    val clientUuid: String,
    val status: String,
    val collection: SyncPushCollectionRefDto? = null,
    val supervisorReview: Boolean = false,
    val replayed: Boolean = false,
    val error: SyncRecordError? = null,
)

@Serializable
data class SyncPushCollectionRefDto(
    val id: String,
    val receiptNo: String,
)

// ---------------------------------------------------------------------------
// /api/sync/pull
// ---------------------------------------------------------------------------

/**
 * Cursor-paginated delta of customers + collections owned by the current
 * tenant (and, for agents, only the collections they themselves recorded).
 *
 * The `cursor` is an ISO-8601 timestamp; pass it back on the next call as
 * `?since=`. The first call may omit `since` to receive a full snapshot.
 */
@Serializable
data class SyncPullResponse(
    val cursor: String,
    val hasMore: Boolean = false,
    val customers: List<SyncCustomerDto> = emptyList(),
    val collections: List<SyncCollectionDto> = emptyList(),
)

/**
 * Pulled customer projection. Mirrors what the agent screens actually
 * need; extra fields are forward-compat thanks to `ignoreUnknownKeys`.
 */
@Serializable
data class SyncCustomerDto(
    val id: String,
    val code: String? = null,
    val name: String,
    val address: String? = null,
    val phone: String? = null,
    val email: String? = null,
    val category: String? = null,
    val lat: Double,
    val lng: Double,
    val geofenceRadiusM: Int,
    val outstandingBalance: Double,
    val creditLimit: Double? = null,
    val isOverdue: Boolean = false,
    val assignedAgentId: String? = null,
    val updatedAt: String,
)

/**
 * Pulled collection projection. Used to hydrate the local cache when the
 * agent reinstalls or signs in on a fresh device.
 */
@Serializable
data class SyncCollectionDto(
    val id: String,
    val clientUuid: String? = null,
    val customerId: String,
    val agentId: String,
    val amount: Double,
    val paymentMode: String,
    val refNo: String? = null,
    val chequeDate: String? = null,
    val remarks: String? = null,
    val collectionLat: Double,
    val collectionLng: Double,
    val gpsAccuracyM: Double? = null,
    val collectedAt: String,
    val receiptNo: String,
    val supervisorReview: Boolean = false,
    val syncStatus: String = "synced",
    val createdAt: String,
    /** Phase 8 - R2 keys persisted on the server row. */
    val photoUrl: String? = null,
    val signatureUrl: String? = null,
)

