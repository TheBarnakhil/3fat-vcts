package com.threefat.vcts.sync

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import dagger.hilt.android.qualifiers.ApplicationContext
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Owns WorkManager registration + the lifetime-of-app
 * [ConnectivityManager.NetworkCallback] that re-fires the drain whenever
 * the device regains network.
 *
 * Singleton so the network callback is registered exactly once, regardless
 * of how many places call [bootstrap].
 */
@Singleton
class SyncScheduler @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    private val workManager: WorkManager by lazy { WorkManager.getInstance(context) }

    @Volatile private var bootstrapped = false

    /**
     * Idempotent. Schedules the periodic drain (replacing any existing
     * registration) and registers the network callback. Safe to call from
     * Application.onCreate as well as from anywhere we want to *force*
     * the sync to be alive (e.g. after first login).
     */
    fun bootstrap() {
        ensurePeriodic()
        if (!bootstrapped) {
            registerNetworkCallback()
            bootstrapped = true
        }
    }

    /**
     * Enqueues an immediate one-time drain. Used by:
     *   - the collection-form flow right after the agent submits,
     *   - the offline-queue screen's "Retry all" button,
     *   - the network callback below.
     *
     * `KEEP` policy collapses redundant requests so spamming submit
     * doesn't fan out to dozens of identical workers.
     */
    fun requestImmediate() {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(connectedConstraints)
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                MIN_BACKOFF_SECONDS,
                TimeUnit.SECONDS,
            )
            .build()
        workManager.enqueueUniqueWork(
            SyncWorker.UNIQUE_ONESHOT,
            ExistingWorkPolicy.KEEP,
            request,
        )
    }

    /**
     * Replace any existing periodic schedule with a fresh one. Cheap;
     * WorkManager dedupes by uniqueWorkName.
     */
    private fun ensurePeriodic() {
        val request = PeriodicWorkRequestBuilder<SyncWorker>(
            PERIOD_MINUTES,
            TimeUnit.MINUTES,
        )
            .setConstraints(connectedConstraints)
            .setBackoffCriteria(
                BackoffPolicy.EXPONENTIAL,
                MIN_BACKOFF_SECONDS,
                TimeUnit.SECONDS,
            )
            .build()
        workManager.enqueueUniquePeriodicWork(
            SyncWorker.UNIQUE_PERIODIC,
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }

    /**
     * The OS callback fires whenever a network with our required
     * capabilities becomes available - even if the device was already
     * connected to a different one. We respond by enqueuing the
     * one-shot worker; WorkManager itself is responsible for actually
     * running it once the constraints + min-execution policies allow.
     */
    private fun registerNetworkCallback() {
        val cm = context.getSystemService(ConnectivityManager::class.java) ?: return
        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
            .addCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
            .build()
        cm.registerNetworkCallback(
            request,
            object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    requestImmediate()
                }
            },
        )
    }

    private val connectedConstraints: Constraints
        get() = Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED)
            .build()

    companion object {
        private const val PERIOD_MINUTES = 15L
        private const val MIN_BACKOFF_SECONDS = 30L
    }
}
