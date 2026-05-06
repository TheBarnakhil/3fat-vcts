package com.threefat.vcts.domain.geo

/**
 * Snapshot of the agent's position relative to a customer's registered
 * geofence. The Detail screen turns this into a coloured indicator and
 * gates the "Start collection" button.
 *
 * [accuracyOk] mirrors the server's `GPS_MAX_ACCURACY_M = 50` default.
 * If the device's reported accuracy is worse, we surface a warning even
 * if the agent is geometrically inside the fence - the server will reject
 * the post otherwise and we want to fail early.
 */
data class GeofenceStatus(
    val distanceM: Double,
    val allowedM: Int,
    val accuracyM: Double?,
    val accuracyOk: Boolean,
) {
    val insideFence: Boolean get() = distanceM <= allowedM
    val canCollect: Boolean get() = insideFence && accuracyOk
}

/** Default GPS accuracy ceiling; matches `web/src/lib/env.ts`. */
const val DEFAULT_GPS_MAX_ACCURACY_M = 50.0

fun geofenceStatus(
    agentLat: Double,
    agentLng: Double,
    accuracyM: Double?,
    customerLat: Double,
    customerLng: Double,
    allowedM: Int,
    maxAccuracyM: Double = DEFAULT_GPS_MAX_ACCURACY_M,
): GeofenceStatus {
    val d = haversineMeters(agentLat, agentLng, customerLat, customerLng)
    val accOk = accuracyM == null || accuracyM <= maxAccuracyM
    return GeofenceStatus(
        distanceM = d,
        allowedM = allowedM,
        accuracyM = accuracyM,
        accuracyOk = accOk,
    )
}
