package com.threefat.vcts

import android.app.Application
import androidx.hilt.work.HiltWorkerFactory
import androidx.work.Configuration
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.threefat.vcts.sync.SyncScheduler
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

/**
 * Hilt entry point. Annotating the [Application] subclass with
 * `@HiltAndroidApp` is what triggers Dagger to generate the global injection
 * graph; without it, no `@Inject` site in the app gets satisfied.
 *
 * Phase 6 responsibilities added here:
 *   - Load the SQLCipher native library before Room ever opens the DB.
 *   - Implement [Configuration.Provider] so WorkManager picks up our
 *     [HiltWorkerFactory] (the AndroidManifest disables the default
 *     auto-init that would beat Hilt to the punch).
 *   - Boot [SyncScheduler] which registers a [ConnectivityManager.NetworkCallback]
 *     so a returning network triggers an immediate drain.
 *
 * Also boots [PDFBoxResourceLoader] once at process start so the on-device
 * receipt preview (Phase 5+) renders without a first-use stall while it
 * extracts its assets.
 */
@HiltAndroidApp
class VctsApplication : Application(), Configuration.Provider {

    @Inject lateinit var workerFactory: HiltWorkerFactory

    @Inject lateinit var syncScheduler: SyncScheduler

    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder()
            .setWorkerFactory(workerFactory)
            .build()

    override fun onCreate() {
        super.onCreate()
        // Must precede any Room.database access; SQLCipher's JNI bindings
        // refuse to open a DB until the native lib is on the loader path.
        // `sqlcipher-android` 4.6+ exposes the lib under the simple name
        // "sqlcipher"; older `android-database-sqlcipher` used a helper
        // method. Doing this once in onCreate is enough for the entire
        // process lifetime.
        System.loadLibrary("sqlcipher")

        PDFBoxResourceLoader.init(applicationContext)

        // Schedule the periodic drain + register the connectivity callback.
        // Cheap to call repeatedly because WorkManager dedupes the periodic
        // request by uniqueWorkName.
        syncScheduler.bootstrap()
    }
}
