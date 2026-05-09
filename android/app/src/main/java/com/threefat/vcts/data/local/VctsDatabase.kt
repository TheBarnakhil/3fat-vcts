package com.threefat.vcts.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.threefat.vcts.data.local.dao.CollectionDao
import com.threefat.vcts.data.local.dao.CustomerDao
import com.threefat.vcts.data.local.dao.LocationLogDao
import com.threefat.vcts.data.local.dao.SyncQueueDao
import com.threefat.vcts.data.local.entity.CollectionEntity
import com.threefat.vcts.data.local.entity.CustomerEntity
import com.threefat.vcts.data.local.entity.LocationLogEntity
import com.threefat.vcts.data.local.entity.SyncQueueEntity

/**
 * Room database. Phase 6 introduced:
 *   1. A new `sync_queue` table holding pending offline mutations.
 *   2. A `sync_status` column on `collections` so the UI can show the
 *      lifecycle of a row (pending / in_flight / synced / failed).
 *   3. A SupportFactory layer (wired in [DatabaseModule]) that opens the
 *      underlying SQLite via SQLCipher with a Keystore-derived passphrase.
 *
 * Phase 7 adds:
 *   4. A `location_logs` table for queued tracker fixes.
 */
@Database(
    entities = [
        CustomerEntity::class,
        CollectionEntity::class,
        SyncQueueEntity::class,
        LocationLogEntity::class,
    ],
    version = 3,
    exportSchema = false,
)
abstract class VctsDatabase : RoomDatabase() {
    abstract fun customerDao(): CustomerDao
    abstract fun collectionDao(): CollectionDao
    abstract fun syncQueueDao(): SyncQueueDao
    abstract fun locationLogDao(): LocationLogDao

    companion object {
        /**
         * Phase 5 used `vcts.db` (plain-text SQLite). Phase 6 switches to
         * SQLCipher and a fresh filename so the two never share a header.
         */
        const val NAME = "vcts-encrypted.db"

        /**
         * Migration from the pre-Phase-6 plain-text DB to the encrypted v2
         * shape. We never actually run this in practice because the
         * filename change above forces a fresh DB, but Room insists every
         * upgrade path be covered. The migration is therefore a no-op:
         * if anyone ever points the encrypted DB at the old file (e.g.
         * during local debugging) Room will at least add the new schema
         * without crashing.
         */
        val MIGRATION_1_2: Migration = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    ALTER TABLE collections
                    ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'synced'
                    """.trimIndent(),
                )
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS sync_queue (
                        client_uuid TEXT NOT NULL PRIMARY KEY,
                        payload_type TEXT NOT NULL,
                        body TEXT NOT NULL,
                        status TEXT NOT NULL,
                        attempts INTEGER NOT NULL,
                        last_error_code TEXT,
                        last_error_message TEXT,
                        enqueued_at INTEGER NOT NULL,
                        last_tried_at INTEGER
                    )
                    """.trimIndent(),
                )
                db.execSQL(
                    """
                    CREATE INDEX IF NOT EXISTS index_sync_queue_status_enqueued_at
                    ON sync_queue (status, enqueued_at)
                    """.trimIndent(),
                )
            }
        }

        /**
         * Phase 7 adds the `location_logs` queue. No data on existing
         * devices needs to migrate over, so the path is just CREATE TABLE.
         */
        val MIGRATION_2_3: Migration = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL(
                    """
                    CREATE TABLE IF NOT EXISTS location_logs (
                        client_uuid TEXT NOT NULL PRIMARY KEY,
                        lat REAL NOT NULL,
                        lng REAL NOT NULL,
                        accuracy_m REAL,
                        battery_pct INTEGER,
                        logged_at TEXT NOT NULL,
                        source TEXT NOT NULL DEFAULT 'tracker',
                        sync_status TEXT NOT NULL DEFAULT 'pending',
                        enqueued_at INTEGER NOT NULL
                    )
                    """.trimIndent(),
                )
                db.execSQL(
                    """
                    CREATE INDEX IF NOT EXISTS index_location_logs_sync_status_logged_at
                    ON location_logs (sync_status, logged_at)
                    """.trimIndent(),
                )
            }
        }
    }
}
