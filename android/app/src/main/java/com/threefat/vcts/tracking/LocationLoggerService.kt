package com.threefat.vcts.tracking

import android.Manifest
import android.annotation.SuppressLint
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.threefat.vcts.R
import com.threefat.vcts.data.repository.LocationLogsRepository
import com.threefat.vcts.sync.SyncScheduler
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Phase 7 foreground service. Captures one GPS fix every
 * [DEFAULT_INTERVAL_MS] millis and persists it via
 * [LocationLogsRepository], then nudges the [SyncScheduler] so the
 * background drain pushes the row up to the server.
 *
 * Why a foreground service?
 *   - Android 8+ kills background services aggressively. A foreground
 *     service with a persistent notification is the only way to keep
 *     getting periodic location updates after the app's UI is gone.
 *   - The notification doubles as a clear visual signal to the agent
 *     that tracking is active - we never collect location silently.
 *
 * Lifecycle:
 *   - Started by [LocationLoggerScheduler.start] when the user toggles
 *     "active duty" on, or by the app on resume if the toggle is on.
 *   - Stopped by [stopService] from anywhere; we always tear down the
 *     `FusedLocationProviderClient` callback in [onDestroy] so the radio
 *     doesn't keep draining after the user disables tracking.
 */
@AndroidEntryPoint
class LocationLoggerService : Service() {

    @Inject lateinit var locationLogsRepository: LocationLogsRepository
    @Inject lateinit var syncScheduler: SyncScheduler

    private val supervisor = SupervisorJob()
    private val scope = CoroutineScope(Dispatchers.Default + supervisor)
    private var inflightWrite: Job? = null

    private val client: FusedLocationProviderClient by lazy {
        LocationServices.getFusedLocationProviderClient(this)
    }

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val loc = result.lastLocation ?: return
            val battery = readBatteryPct()
            val capturedAt = System.currentTimeMillis()
            // We snapshot the values up front so the coroutine body
            // doesn't re-read mutable system services on a worker thread.
            val lat = loc.latitude
            val lng = loc.longitude
            val accuracy = if (loc.hasAccuracy()) loc.accuracy.toDouble() else null

            // Single-flight: we don't allow a queued write to pile up
            // behind a previous slow one. Dropping a duplicate fix is
            // harmless; the next minute will produce another anyway.
            if (inflightWrite?.isActive == true) {
                android.util.Log.d(TAG, "skip fix; previous write still active")
                return
            }
            inflightWrite = scope.launch {
                runCatching {
                    locationLogsRepository.recordFix(
                        lat = lat,
                        lng = lng,
                        accuracyM = accuracy,
                        batteryPct = battery,
                        capturedAtMs = capturedAt,
                    )
                    syncScheduler.requestImmediate()
                }.onFailure {
                    android.util.Log.w(TAG, "recordFix failed", it)
                }
                updateNotification(lat, lng, accuracy)
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        startInForeground()
        beginRequesting()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // START_STICKY so the OS restarts us if we're killed (e.g. for
        // memory). Each restart re-requests location updates, which
        // bootstraps the next fix without UI involvement.
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        client.removeLocationUpdates(callback)
        scope.cancel()
        super.onDestroy()
    }

    private fun startInForeground() {
        val notification = TrackingNotifications.build(
            this,
            getString(R.string.tracking_notification_default_text),
        )
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        } else {
            0
        }
        ServiceCompat.startForeground(
            this,
            TrackingNotifications.NOTIFICATION_ID,
            notification,
            type,
        )
    }

    @SuppressLint("MissingPermission")
    private fun beginRequesting() {
        if (!hasFineLocationPermission()) {
            android.util.Log.w(TAG, "fine-location permission missing; stopping self")
            stopSelf()
            return
        }
        val request = LocationRequest.Builder(
            Priority.PRIORITY_BALANCED_POWER_ACCURACY,
            DEFAULT_INTERVAL_MS,
        )
            .setMinUpdateIntervalMillis(DEFAULT_INTERVAL_MS / 2)
            .setMaxUpdateDelayMillis(DEFAULT_INTERVAL_MS * 2)
            .setWaitForAccurateLocation(false)
            .build()
        client.requestLocationUpdates(request, callback, Looper.getMainLooper())
    }

    private fun updateNotification(lat: Double, lng: Double, accuracyM: Double?) {
        val text = if (accuracyM != null) {
            getString(
                R.string.tracking_notification_recent_with_accuracy,
                lat,
                lng,
                accuracyM.toInt(),
            )
        } else {
            getString(R.string.tracking_notification_recent_no_accuracy, lat, lng)
        }
        val n = TrackingNotifications.build(this, text)
        NotificationManagerCompat.from(this)
            .notify(TrackingNotifications.NOTIFICATION_ID, n)
    }

    private fun hasFineLocationPermission(): Boolean = ContextCompat.checkSelfPermission(
        this,
        Manifest.permission.ACCESS_FINE_LOCATION,
    ) == PackageManager.PERMISSION_GRANTED

    /**
     * Sticky-broadcast read of the current battery level. We tag every
     * fix with this so a reviewer can correlate "low battery" with
     * degraded fix accuracy or missed intervals.
     */
    private fun readBatteryPct(): Int? {
        val intent = registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            ?: return null
        val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
        if (level < 0 || scale <= 0) return null
        return ((level * 100f) / scale).toInt().coerceIn(0, 100)
    }

    companion object {
        private const val TAG = "LocLoggerSvc"

        /** Tracker interval - matches the 5-min cadence in the PRD. */
        const val DEFAULT_INTERVAL_MS: Long = 5L * 60 * 1000

        /** Idempotent helper used by [LocationLoggerScheduler]. */
        fun start(context: Context) {
            val intent = Intent(context, LocationLoggerService::class.java)
            ContextCompat.startForegroundService(context, intent)
        }

        fun stop(context: Context) {
            val intent = Intent(context, LocationLoggerService::class.java)
            context.stopService(intent)
        }
    }
}
