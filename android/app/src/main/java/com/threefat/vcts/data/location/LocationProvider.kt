package com.threefat.vcts.data.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Looper
import androidx.core.content.ContextCompat
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Thin wrapper around `FusedLocationProviderClient`. Two surfaces:
 *
 *  - [observe]: a hot Flow of [LocationFix] used while the agent is
 *    walking towards a customer. The detail screen subscribes; on
 *    leaving the screen the cancellation propagates to
 *    [FusedLocationProviderClient.removeLocationUpdates] so the GPS
 *    radio doesn't keep draining the battery.
 *
 *  - [requestSingleFix]: blocks the caller until one fresh fix is
 *    available. Used at the exact moment of collection-submit so the
 *    coordinates we send are as recent as possible.
 *
 * Both methods *require* `ACCESS_FINE_LOCATION` granted at runtime. The
 * caller is responsible for obtaining permission before invoking; the
 * Composable helper [com.threefat.vcts.ui.location.LocationPermissionGate]
 * does that.
 */
@Singleton
class LocationProvider @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    private val client: FusedLocationProviderClient by lazy {
        LocationServices.getFusedLocationProviderClient(context)
    }

    fun hasFineLocationPermission(): Boolean = ContextCompat.checkSelfPermission(
        context,
        Manifest.permission.ACCESS_FINE_LOCATION,
    ) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    fun observe(intervalMs: Long = 3_000L): Flow<LocationFix> = callbackFlow {
        if (!hasFineLocationPermission()) {
            close()
            return@callbackFlow
        }

        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, intervalMs)
            .setMinUpdateIntervalMillis(intervalMs)
            .setWaitForAccurateLocation(false)
            .build()

        val callback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                result.lastLocation?.let { loc ->
                    trySend(
                        LocationFix(
                            lat = loc.latitude,
                            lng = loc.longitude,
                            accuracyM = if (loc.hasAccuracy()) loc.accuracy.toDouble() else null,
                            timestampMs = loc.time,
                        ),
                    )
                }
            }
        }

        client.requestLocationUpdates(request, callback, Looper.getMainLooper())

        awaitClose {
            client.removeLocationUpdates(callback)
        }
    }

    /**
     * One-shot fresh fix. Throws [SecurityException] if the caller
     * forgot to check [hasFineLocationPermission]. Returns null if the
     * platform can't supply a fix in time (e.g. GPS hardware off).
     */
    @SuppressLint("MissingPermission")
    suspend fun requestSingleFix(): LocationFix? {
        if (!hasFineLocationPermission()) return null
        val request = CurrentLocationRequest.Builder()
            .setPriority(Priority.PRIORITY_HIGH_ACCURACY)
            .setDurationMillis(10_000L)
            .build()
        val location = client.getCurrentLocation(request, null).await() ?: return null
        return LocationFix(
            lat = location.latitude,
            lng = location.longitude,
            accuracyM = if (location.hasAccuracy()) location.accuracy.toDouble() else null,
            timestampMs = location.time,
        )
    }
}
