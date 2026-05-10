package com.threefat.vcts.data.preferences

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import com.threefat.vcts.domain.model.ThemeMode
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import java.util.UUID

/**
 * Plain-text user preferences (theme + last-known tenant). Sensitive values
 * (refresh token) live in [com.threefat.vcts.data.preferences.SecureStore]
 * instead.
 *
 * DataStore is preferred over SharedPreferences for new code: it's coroutine-
 * native, type-safe, and avoids the long-running disk-IO-on-main-thread
 * surprises that bit Android dev for a decade.
 */
private val Context.appDataStore: androidx.datastore.core.DataStore<Preferences> by preferencesDataStore(
    name = "vcts_app_prefs",
)

private object Keys {
    val THEME_MODE = stringPreferencesKey("theme_mode")
    val LAST_EMAIL = stringPreferencesKey("last_email")
    val LAST_TENANT_ID = stringPreferencesKey("last_tenant_id")
    val LAST_TENANT_SLUG = stringPreferencesKey("last_tenant_slug")

    // Phase 6: cursor + last-success timestamp for the offline sync engine.
    // Stored alongside the rest of the user prefs because they're tightly
    // coupled to the active session - clearing session traces also clears
    // these so a fresh login starts with a full pull.
    val SYNC_PULL_CURSOR = stringPreferencesKey("sync_pull_cursor")
    val SYNC_LAST_SUCCESS_AT = longPreferencesKey("sync_last_success_at")

    // Phase 7: agent's "active duty" toggle (drives the foreground tracker
    // service) and the last successful fix timestamp shown on the dashboard.
    // Cleared on logout / tenant change because tracking is a session
    // contract, not a device-wide setting.
    val TRACKING_ENABLED = booleanPreferencesKey("tracking_enabled")
    val TRACKING_LAST_FIX_AT = longPreferencesKey("tracking_last_fix_at")

    // Phase 10 (Track B): device-binding install UUID. Generated once on
    // first read, persisted across logouts (it identifies the *device*, not
    // the user), survives app upgrades, dies on uninstall / Clear Data.
    // Sent as `installId` on login + refresh so the server can bind the
    // refresh token to this device.
    val INSTALL_ID = stringPreferencesKey("install_id")
}

class AppPreferences(private val context: Context) {

    val themeMode: Flow<ThemeMode> = context.appDataStore.data.map { prefs ->
        ThemeMode.fromKey(prefs[Keys.THEME_MODE])
    }

    suspend fun setThemeMode(mode: ThemeMode) {
        context.appDataStore.edit { it[Keys.THEME_MODE] = mode.storageKey }
    }

    val lastEmail: Flow<String?> = context.appDataStore.data.map { it[Keys.LAST_EMAIL] }

    suspend fun setLastEmail(email: String) {
        context.appDataStore.edit { it[Keys.LAST_EMAIL] = email.trim().lowercase() }
    }

    suspend fun cacheTenant(tenantId: String, tenantSlug: String) {
        context.appDataStore.edit { prefs ->
            prefs[Keys.LAST_TENANT_ID] = tenantId
            prefs[Keys.LAST_TENANT_SLUG] = tenantSlug
        }
    }

    val cachedTenantId: Flow<String?> = context.appDataStore.data.map { it[Keys.LAST_TENANT_ID] }

    val syncPullCursor: Flow<String?> =
        context.appDataStore.data.map { it[Keys.SYNC_PULL_CURSOR] }

    val syncLastSuccessAt: Flow<Long?> =
        context.appDataStore.data.map { it[Keys.SYNC_LAST_SUCCESS_AT] }

    suspend fun setSyncPullCursor(cursor: String) {
        context.appDataStore.edit { it[Keys.SYNC_PULL_CURSOR] = cursor }
    }

    suspend fun setSyncLastSuccessAt(epochMillis: Long) {
        context.appDataStore.edit { it[Keys.SYNC_LAST_SUCCESS_AT] = epochMillis }
    }

    val trackingEnabled: Flow<Boolean> =
        context.appDataStore.data.map { it[Keys.TRACKING_ENABLED] ?: false }

    suspend fun setTrackingEnabled(enabled: Boolean) {
        context.appDataStore.edit { it[Keys.TRACKING_ENABLED] = enabled }
    }

    val trackingLastFixAt: Flow<Long?> =
        context.appDataStore.data.map { it[Keys.TRACKING_LAST_FIX_AT] }

    suspend fun setTrackingLastFixAt(epochMillis: Long) {
        context.appDataStore.edit { it[Keys.TRACKING_LAST_FIX_AT] = epochMillis }
    }

    /**
     * Returns the persistent install UUID, generating + persisting one on
     * first call. Identifies *this app on this device*; survives logout
     * but dies on uninstall / Clear Data so a fresh install transparently
     * looks like a new device to the server.
     *
     * The two-step "read, generate-if-null, write" sequence is racy in
     * theory but harmless in practice - if two coroutines collide we just
     * end up with one of the two UUIDs winning, and both reads after the
     * write see the same value.
     */
    suspend fun getOrCreateInstallId(): String {
        val existing = context.appDataStore.data.first()[Keys.INSTALL_ID]
        if (!existing.isNullOrBlank()) return existing
        val fresh = UUID.randomUUID().toString()
        context.appDataStore.edit { it[Keys.INSTALL_ID] = fresh }
        return fresh
    }

    /**
     * Wipes everything except the theme preference (UI choice, not a session
     * concern) and the install UUID (device identifier, not a session
     * credential). Called on logout.
     */
    suspend fun clearSessionTraces() {
        context.appDataStore.edit { prefs ->
            val theme = prefs[Keys.THEME_MODE]
            val installId = prefs[Keys.INSTALL_ID]
            prefs.clear()
            if (theme != null) prefs[Keys.THEME_MODE] = theme
            if (installId != null) prefs[Keys.INSTALL_ID] = installId
        }
    }
}
