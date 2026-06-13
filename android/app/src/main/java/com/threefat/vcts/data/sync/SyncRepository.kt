package com.threefat.vcts.data.sync

import com.threefat.vcts.data.local.dao.CollectionDao
import com.threefat.vcts.data.local.dao.LocationLogDao
import com.threefat.vcts.data.local.dao.SyncQueueDao
import com.threefat.vcts.data.preferences.AppPreferences
import com.threefat.vcts.domain.sync.AttachmentPushSummary
import com.threefat.vcts.domain.sync.LocationPushSummary
import com.threefat.vcts.domain.sync.PullSummary
import com.threefat.vcts.domain.sync.PushSummary
import com.threefat.vcts.domain.sync.SyncSummary
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.Flow

/**
 * Top-level facade over the offline sync engine. The workers call into
 * this class instead of constructing a drainer + puller themselves so the
 * "what does a sync round actually do" decision lives in one place.
 *
 * Phase 7 adds the tracker-fix drainer. Order inside [syncOnce]:
 *   1. Drain collection submissions (highest priority; agent's expected
 *      "did my receipt sync" feedback loop).
 *   2. Drain tracker fixes (high-volume, idempotent, low criticality).
 *   3. Pull deltas to refresh the local cache.
 */
@Singleton
class SyncRepository @Inject constructor(
    private val pushDrainer: CollectionsPushDrainer,
    private val cmsPushDrainer: CmsPushDrainer,
    private val locationLogsPushDrainer: LocationLogsPushDrainer,
    private val attachmentsPushDrainer: AttachmentsPushDrainer,
    private val pullSync: PullSync,
    private val queueDao: SyncQueueDao,
    private val locationLogDao: LocationLogDao,
    private val collectionDao: CollectionDao,
    private val appPreferences: AppPreferences,
) {

    /** Live pending+failed queue depth for the dashboard badge. */
    fun observePendingCount(): Flow<Int> = queueDao.observePendingCount()

    /** Live unsynced tracker-fix depth for the active-duty badge. */
    fun observePendingLocationLogCount(): Flow<Int> =
        locationLogDao.observePendingCount()

    /** Live count of synced collections still waiting to upload attachments. */
    fun observePendingAttachmentCount(): Flow<Int> =
        collectionDao.observePendingAttachmentCount()

    /** Last time a worker successfully completed any phase of a sync. */
    fun observeLastSyncAt(): Flow<Long?> = appPreferences.syncLastSuccessAt

    /**
     * Drain the push queue + tracker fixes, then run one pull pass.
     * Returns the per-pass summary so the worker can decide to retry /
     * chain another run.
     */
    suspend fun syncOnce(): SyncSummary {
        val push = drainPushUntilStable()
        val locationPush = drainLocationLogsUntilStable()
        // Attachments must run after the collection push so any rows
        // that just got their server id are eligible.
        val attachmentPush = drainAttachmentsUntilStable()
        val cmsPush = drainCmsUntilStable()
        val pull = runCatching { pullSync.pullOnce() }.getOrElse {
            // Pull failures are non-fatal for this round; let the worker
            // backoff and retry on the next tick.
            null
        }
        val anyClean =
            push?.isClean == true ||
                cmsPush?.isClean == true ||
                locationPush?.isClean == true ||
                attachmentPush?.isClean == true ||
                pull != null
        if (anyClean) {
            appPreferences.setSyncLastSuccessAt(System.currentTimeMillis())
        }
        return SyncSummary(
            push = push,
            pull = pull,
            locationPush = locationPush,
            attachmentPush = attachmentPush,
        )
    }

    /** Push-only, used by the immediate post-submit kick. */
    suspend fun pushOnly(): PushSummary? = drainPushUntilStable()

    /** Attachment-only, used by the receipt screen on demand. */
    suspend fun pushAttachmentsOnly(): AttachmentPushSummary? =
        drainAttachmentsUntilStable()

    /** Pull-only, used on dashboard resume / manual refresh. */
    suspend fun pullOnly(): PullSummary? =
        runCatching { pullSync.pullOnce() }.getOrNull()

    /** Tracker-fix push only, used by the tracker service after each batch. */
    suspend fun pushLocationLogsOnly(): LocationPushSummary? =
        drainLocationLogsUntilStable()

    private suspend fun drainPushUntilStable(): PushSummary? {
        var aggregate: PushSummary? = null
        var rounds = 0
        while (rounds < MAX_ROUNDS) {
            val pass = pushDrainer.drainOnce()
            aggregate = combine(aggregate, pass)
            // Stop when nothing was attempted (queue empty) or the round
            // hit a transient failure (so we yield back to the worker's
            // retry policy instead of looping endlessly against the
            // network failure).
            if (pass.attempted == 0) break
            if (pass.transientFailures > 0) break
            rounds += 1
        }
        return aggregate
    }

    private suspend fun drainLocationLogsUntilStable(): LocationPushSummary? {
        var aggregate: LocationPushSummary? = null
        var rounds = 0
        while (rounds < MAX_ROUNDS) {
            val pass = locationLogsPushDrainer.drainOnce()
            aggregate = combineLocation(aggregate, pass)
            if (pass.attempted == 0) break
            if (pass.transientFailures > 0) break
            rounds += 1
        }
        return aggregate
    }

    private suspend fun drainCmsUntilStable(): PushSummary? {
        var aggregate: PushSummary? = null
        var rounds = 0
        while (rounds < MAX_ROUNDS) {
            val pass = cmsPushDrainer.drainOnce()
            aggregate = combine(aggregate, pass)
            if (pass.attempted == 0) break
            if (pass.transientFailures > 0) break
            rounds += 1
        }
        return aggregate
    }

    private suspend fun drainAttachmentsUntilStable(): AttachmentPushSummary? {
        var aggregate: AttachmentPushSummary? = null
        var rounds = 0
        while (rounds < MAX_ROUNDS) {
            val pass = attachmentsPushDrainer.drainOnce()
            aggregate = combineAttachment(aggregate, pass)
            if (pass.attempted == 0) break
            if (pass.transientFailures > 0) break
            rounds += 1
        }
        return aggregate
    }

    private fun combine(a: PushSummary?, b: PushSummary): PushSummary {
        if (a == null) return b
        return PushSummary(
            attempted = a.attempted + b.attempted,
            created = a.created + b.created,
            duplicate = a.duplicate + b.duplicate,
            rejected = a.rejected + b.rejected,
            transientFailures = a.transientFailures + b.transientFailures,
            supervisorReview = a.supervisorReview + b.supervisorReview,
        )
    }

    private fun combineLocation(
        a: LocationPushSummary?,
        b: LocationPushSummary,
    ): LocationPushSummary {
        if (a == null) return b
        return LocationPushSummary(
            attempted = a.attempted + b.attempted,
            acknowledged = a.acknowledged + b.acknowledged,
            transientFailures = a.transientFailures + b.transientFailures,
            pruned = a.pruned + b.pruned,
        )
    }

    private fun combineAttachment(
        a: AttachmentPushSummary?,
        b: AttachmentPushSummary,
    ): AttachmentPushSummary {
        if (a == null) return b
        return AttachmentPushSummary(
            attempted = a.attempted + b.attempted,
            uploaded = a.uploaded + b.uploaded,
            transientFailures = a.transientFailures + b.transientFailures,
        )
    }

    companion object {
        /** Hard ceiling on how many push batches we drain per worker run. */
        private const val MAX_ROUNDS = 8
    }
}
