package com.threefat.vcts.data.remote.dto

import kotlinx.serialization.Serializable

/**
 * One queued GPS fix sent to `/api/location-logs/batch`. Mirrors the
 * Zod schema in `web/src/app/api/location-logs/batch/route.ts`.
 */
@Serializable
data class LocationLogBody(
    val clientUuid: String,
    val lat: Double,
    val lng: Double,
    val accuracyM: Double? = null,
    val batteryPct: Int? = null,
    /** ISO-8601 UTC timestamp captured at fix time. */
    val loggedAt: String,
    val source: String = "tracker",
)

@Serializable
data class LocationLogsBatchRequest(
    val logs: List<LocationLogBody>,
)

@Serializable
data class LocationLogOutcomeDto(
    val clientUuid: String,
    /** "created" or "duplicate". Both count as success on the device. */
    val status: String,
)

@Serializable
data class LocationLogsBatchCountsDto(
    val created: Int = 0,
    val duplicate: Int = 0,
)

@Serializable
data class LocationLogsBatchResponse(
    val outcomes: List<LocationLogOutcomeDto>,
    val counts: LocationLogsBatchCountsDto,
)
