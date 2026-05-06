package com.threefat.vcts.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.threefat.vcts.data.local.dao.CollectionDao
import com.threefat.vcts.data.local.dao.CustomerDao
import com.threefat.vcts.data.local.dao.SyncQueueDao
import com.threefat.vcts.data.local.entity.CollectionEntity
import com.threefat.vcts.data.local.entity.CustomerEntity
import com.threefat.vcts.data.local.entity.SyncQueueEntity

/**
 * Room database. Phase 6 introduces:
 *   1. A new `sync_queue` table holding pending offline mutations.
 *   2. A `sync_status` column on `collections` so the UI can show the
 *      lifecycle of a row (pending / in_flight / synced / failed).
 *   3. A SupportFactory layer (wired in [DatabaseModule]) that opens the
 *      underlying SQLite via SQLCipher with a Keystore-derived passphrase.
 *
 * Because SQLCipher's first-time encryption happens at file create, the
 * existing plain-text `vcts.db` from Phase 5 is intentionally orphaned -
 * we open a new encrypted file with a fresh name. That's effectively a
 * destructive migration; pre-launch this is acceptable and the Phase 5
 * cache is re-fetched from `/api/sync/pull` on next login anyway.
 */
@Database(
    entities = [
        CustomerEntity::class,
        CollectionEntity::class,
        SyncQueueEntity::class,
    ],
    version = 2,
    exportSchema = false,
)
abstract class VctsDatabase : RoomDatabase() {
    abstract fun customerDao(): CustomerDao
    abstract fun collectionDao(): CollectionDao
    abstract fun syncQueueDao(): SyncQueueDao

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
    }
}
