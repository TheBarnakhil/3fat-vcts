package com.threefat.vcts.data.repository

import com.threefat.vcts.data.local.VctsDatabase
import com.threefat.vcts.data.preferences.AppPreferences
import com.threefat.vcts.data.preferences.SecureStore
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Single seam for "delete every byte that belongs to the previous tenant on
 * this device". Phase 5 added the Room cache (customers + collections);
 * Phase 6 extends the wipe to the offline sync queue so a different tenant
 * never inherits in-flight collection submissions from the previous user.
 *
 * We deliberately do NOT rotate the SQLCipher passphrase on every logout:
 * the local DB is already wiped of tenant rows, and rotating the key would
 * orphan the encrypted file (forcing a full re-pull on every signin which
 * is a poor UX). Phase 10's hardening pass will add an explicit
 * "panic wipe" entry point that does rotate the key.
 *
 * Both call sites - logout and silent tenant change at login time - go
 * through the same code path so we never forget to wipe one but not the
 * other.
 */
@Singleton
class TenantDataWiper @Inject constructor(
    private val appPreferences: AppPreferences,
    private val secureStore: SecureStore,
    private val database: VctsDatabase,
) {
    suspend fun wipeOnLogout() {
        clearLocalState()
    }

    @Suppress("UNUSED_PARAMETER")
    suspend fun wipeOnTenantChange(oldTenantId: String?, newTenantId: String) {
        // Logout-equivalent wipe; the new tenant's session is committed by
        // the caller immediately after this returns.
        clearLocalState()
    }

    private suspend fun clearLocalState() {
        // Order matters: clear room first so any in-flight observer reads
        // an empty cache before we drop the auth tokens that allow it to
        // re-fetch. The sync queue and tracker fixes are part of that
        // wipe - we never want pending mutations or location data from a
        // previous tenant to flush against a new tenant's bearer token.
        runCatching {
            database.syncQueueDao().clear()
            database.locationLogDao().clear()
            database.customerDao().clear()
            database.collectionDao().clear()
        }
        secureStore.clear()
        appPreferences.clearSessionTraces()
    }
}
