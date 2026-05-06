package com.threefat.vcts.domain.sync

/**
 * Lifecycle of a single queued mutation. The wire string is what the
 * Room column stores; do not rename without a migration.
 *
 *   PENDING   - written locally, never attempted (e.g. offline)
 *   IN_FLIGHT - currently being POSTed by the worker (lets the UI grey out
 *               the retry button without a separate boolean)
 *   SYNCED    - server returned 2xx; queue row is purged shortly after
 *   FAILED    - the server permanently rejected the row (e.g. geofence
 *               violation, customer no longer exists). UI surfaces the
 *               last_error_message; the agent must triage manually.
 */
enum class SyncStatus(val wire: String) {
    PENDING("pending"),
    IN_FLIGHT("in_flight"),
    SYNCED("synced"),
    FAILED("failed");

    companion object {
        fun fromWire(value: String?): SyncStatus = when (value) {
            "pending" -> PENDING
            "in_flight" -> IN_FLIGHT
            "synced" -> SYNCED
            "failed" -> FAILED
            // Default to PENDING when we read an unknown value - safer than
            // silently dropping the row from the queue.
            else -> PENDING
        }
    }
}
