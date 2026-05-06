package com.threefat.vcts.data.location

/**
 * Minimal location snapshot used across the geofence + collection-form
 * stack. We intentionally don't surface every field on Android's
 * `Location` (bearing, vertical accuracy, etc.) to keep the rest of the
 * domain decoupled from the platform type.
 */
data class LocationFix(
    val lat: Double,
    val lng: Double,
    /** Reported horizontal accuracy in metres, if the platform supplied it. */
    val accuracyM: Double?,
    /** UTC epoch millis of the fix. */
    val timestampMs: Long,
)
