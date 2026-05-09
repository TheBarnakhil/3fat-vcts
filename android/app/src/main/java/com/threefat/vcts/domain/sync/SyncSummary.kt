package com.threefat.vcts.domain.sync

/**
 * Aggregate result of one drain pass. Used by the worker's chained-result
 * type and by the queue UI to show a flash message after a manual retry.
 */
data class PushSummary(
    val attempted: Int,
    val created: Int,
    val duplicate: Int,
    val rejected: Int,
    val transientFailures: Int,
    val supervisorReview: Int,
) {
    val isClean: Boolean get() = transientFailures == 0 && rejected == 0
}

data class PullSummary(
    val customersUpserted: Int,
    val collectionsUpserted: Int,
    val cursor: String,
    val hasMore: Boolean,
)

/**
 * Phase 7: tracker-fix drain summary. Lighter than [PushSummary] because
 * the location-log batch endpoint has no per-record reconciliation - we
 * only care about how many rows we tried to push and how many the server
 * ack'd as either created or duplicate.
 */
data class LocationPushSummary(
    val attempted: Int,
    val acknowledged: Int,
    val transientFailures: Int,
    val pruned: Int,
) {
    val isClean: Boolean get() = transientFailures == 0
}

data class SyncSummary(
    val push: PushSummary?,
    val pull: PullSummary?,
    val locationPush: LocationPushSummary? = null,
)
