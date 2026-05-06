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

data class SyncSummary(
    val push: PushSummary?,
    val pull: PullSummary?,
)
