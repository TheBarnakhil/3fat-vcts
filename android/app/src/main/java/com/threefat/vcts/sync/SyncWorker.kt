package com.threefat.vcts.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.threefat.vcts.data.sync.SyncRepository
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject

/**
 * The drain + delta worker. Runs on:
 *   - app start (one-time, immediate),
 *   - return-of-network connectivity (one-time, via [SyncScheduler]'s
 *     [android.net.ConnectivityManager.NetworkCallback]),
 *   - WorkManager's periodic schedule (every 15 min, network-constrained),
 *   - explicit user retry from the offline-queue UI.
 *
 * One worker handles both push and pull because the agent's mental model
 * is "everything's in sync" - splitting them across two workers leads to
 * window where pending submissions are visible while the customer ledger
 * lags behind.
 */
@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted workerParams: WorkerParameters,
    private val syncRepository: SyncRepository,
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        return try {
            val summary = syncRepository.syncOnce()
            // If we hit a transient failure on push, ask WorkManager to
            // retry with backoff. Permanent failures (rejected rows) are
            // a signal of bad data, not bad network, so we still consider
            // the run successful and let the queue UI surface them.
            val transient = summary.push?.transientFailures ?: 0
            if (transient > 0) Result.retry() else Result.success()
        } catch (e: Throwable) {
            // Unexpected blowup - retry with backoff to avoid losing the
            // queued work.
            android.util.Log.w("SyncWorker", "doWork threw", e)
            Result.retry()
        }
    }

    companion object {
        const val UNIQUE_PERIODIC = "vcts.sync.periodic"
        const val UNIQUE_ONESHOT = "vcts.sync.oneshot"
    }
}
