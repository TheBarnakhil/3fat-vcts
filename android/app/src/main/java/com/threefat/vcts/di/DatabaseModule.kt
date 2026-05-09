package com.threefat.vcts.di

import android.content.Context
import androidx.room.Room
import com.threefat.vcts.data.local.DatabaseKeyProvider
import com.threefat.vcts.data.local.VctsDatabase
import com.threefat.vcts.data.local.dao.CollectionDao
import com.threefat.vcts.data.local.dao.CustomerDao
import com.threefat.vcts.data.local.dao.LocationLogDao
import com.threefat.vcts.data.local.dao.SyncQueueDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton
import net.zetetic.database.sqlcipher.SupportOpenHelperFactory

/**
 * Provides the singleton Room database and DAOs.
 *
 * Phase 6 wires the underlying SQLite through SQLCipher's
 * [SupportOpenHelperFactory]. Everything Room does (schema, queries,
 * transactions) is unaffected; only the bytes on disk are now AES-encrypted.
 *
 * The passphrase comes from [DatabaseKeyProvider] - generated once per
 * install, sealed in a Keystore-backed [androidx.security.crypto.EncryptedSharedPreferences].
 *
 * The static schema migration declared on [VctsDatabase] is registered for
 * forward compatibility but in practice we changed the DB filename, so the
 * upgrade path is never exercised - new installs (and the once-only
 * upgrade from a Phase 5 build) always start with the v2 schema.
 */
@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(
        @ApplicationContext context: Context,
        keyProvider: DatabaseKeyProvider,
    ): VctsDatabase {
        val passphrase = keyProvider.getOrCreatePassphrase()
        val factory = SupportOpenHelperFactory(passphrase)

        return Room.databaseBuilder(
            context,
            VctsDatabase::class.java,
            VctsDatabase.NAME,
        )
            .openHelperFactory(factory)
            .addMigrations(
                VctsDatabase.MIGRATION_1_2,
                VctsDatabase.MIGRATION_2_3,
            )
            // Pre-launch we still allow destructive fallback so a corrupt
            // local DB after a stalled install doesn't brick the agent's
            // workflow - the offline queue is rebuilt from /sync/pull.
            .fallbackToDestructiveMigration()
            .build()
    }

    @Provides
    fun provideCustomerDao(db: VctsDatabase): CustomerDao = db.customerDao()

    @Provides
    fun provideCollectionDao(db: VctsDatabase): CollectionDao = db.collectionDao()

    @Provides
    fun provideSyncQueueDao(db: VctsDatabase): SyncQueueDao = db.syncQueueDao()

    @Provides
    fun provideLocationLogDao(db: VctsDatabase): LocationLogDao = db.locationLogDao()
}
