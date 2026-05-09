package com.threefat.vcts.tracking

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import com.threefat.vcts.data.preferences.AppPreferences
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first

/**
 * Owns the "is the tracker currently running?" decision so the rest of
 * the app talks to one seam instead of poking the [Service] directly.
 *
 * Pure side-effects, no Compose. The dashboard / settings call
 * [enable]/[disable] in response to the agent flipping the toggle; the
 * Application's onResume hook calls [maybeRestart] so a process restart
 * doesn't drop tracking on the floor.
 */
@Singleton
class LocationLoggerScheduler @Inject constructor(
    @ApplicationContext private val context: Context,
    private val appPreferences: AppPreferences,
) {

    /**
     * Persist the toggle and (re)start the service if foreground
     * permission is held. The service itself stops if background-
     * location permission is missing - the user gets a one-time
     * rationale before that happens.
     */
    suspend fun enable() {
        appPreferences.setTrackingEnabled(true)
        if (canStartTracker()) {
            LocationLoggerService.start(context)
        }
    }

    suspend fun disable() {
        appPreferences.setTrackingEnabled(false)
        LocationLoggerService.stop(context)
    }

    /**
     * Restart the tracker iff the user previously enabled it AND we
     * still hold the necessary permissions. Called from
     * [com.threefat.vcts.VctsApplication.onCreate] to survive process
     * death.
     */
    suspend fun maybeRestart() {
        val enabled = appPreferences.trackingEnabled.first()
        if (!enabled) return
        if (canStartTracker()) {
            LocationLoggerService.start(context)
        }
    }

    /**
     * The OS has its own "background location is granted" gate that
     * we surface in the rationale UI; here we only care that
     * fine-location is held so the FLP request itself succeeds.
     */
    fun canStartTracker(): Boolean {
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
    }

    /**
     * Returns whether the agent has granted background-location. We use
     * this in the dashboard banner to remind them that the tracker can
     * keep running when the app is in the background.
     */
    fun hasBackgroundLocation(): Boolean {
        if (android.os.Build.VERSION.SDK_INT < android.os.Build.VERSION_CODES.Q) {
            // Pre-Q the foreground permission is enough.
            return canStartTracker()
        }
        return ContextCompat.checkSelfPermission(
            context,
            Manifest.permission.ACCESS_BACKGROUND_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
    }
}
