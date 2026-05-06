package com.threefat.vcts.domain.geo

import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Great-circle distance in metres. Bit-for-bit identical to the server's
 * `web/src/lib/geo/haversine.ts` so the client's pre-flight check matches
 * the authoritative server validation - if we say "you're inside the
 * fence" and unlock the form, the POST will not fail with a geofence
 * violation.
 *
 * `R = 6_371_000 m` is the WGS84 mean Earth radius. Accuracy is ~0.5%, an
 * order of magnitude better than typical GPS noise.
 */
fun haversineMeters(
    aLat: Double,
    aLng: Double,
    bLat: Double,
    bLng: Double,
): Double {
    val r = 6_371_000.0

    fun rad(deg: Double) = deg * Math.PI / 180.0

    val dLat = rad(bLat - aLat)
    val dLng = rad(bLng - aLng)
    val lat1 = rad(aLat)
    val lat2 = rad(bLat)

    val sinDLat = sin(dLat / 2)
    val sinDLng = sin(dLng / 2)

    val h = sinDLat * sinDLat + cos(lat1) * cos(lat2) * sinDLng * sinDLng
    return 2 * r * asin(min(1.0, sqrt(h)))
}
