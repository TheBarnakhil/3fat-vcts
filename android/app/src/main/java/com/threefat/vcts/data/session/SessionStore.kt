package com.threefat.vcts.data.session

import com.threefat.vcts.data.preferences.AppPreferences
import com.threefat.vcts.data.preferences.SecureStore
import com.threefat.vcts.domain.model.Session
import com.threefat.vcts.domain.model.SessionPublicInfo
import com.threefat.vcts.domain.model.publicInfo
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Single source of truth for the live [Session]. Bridges three storage tiers:
 *
 *  - in-memory: [accessToken], full [Session] object
 *  - encrypted disk ([SecureStore]): [Session.refreshToken]
 *  - plain disk ([AppPreferences]): tenant slug/name/accent for splash UX
 *
 * Cross-tenant safety: [setSession] compares the incoming tenantId to the one
 * we have cached. If they differ, [onTenantChange] runs first so callers can
 * wipe local DBs (Phase 6+) before the new identity is committed. Until that
 * runs, no UI sees the new session.
 */
@Singleton
class SessionStore @Inject constructor(
    private val secureStore: SecureStore,
    private val appPreferences: AppPreferences,
) {

    private val _session = MutableStateFlow<Session?>(null)
    val session: Flow<Session?> = _session.asStateFlow()

    val publicInfo: Flow<SessionPublicInfo?> = _session.map { it?.publicInfo() }

    /** In-memory access-token snapshot for synchronous interceptor lookup. */
    @Volatile
    var accessTokenSnapshot: String? = null
        private set

    /** Persisted; survives a process restart so we can call /refresh without re-login. */
    val persistedRefreshToken: String?
        get() = secureStore.refreshToken

    val cachedTenantId: Flow<String?> = appPreferences.cachedTenantId

    /**
     * Persists a new session, optionally invoking [onTenantChange] *before*
     * the new identity becomes visible if it differs from the cached one.
     * The block is suspendable so callers can clear Room (Phase 6+) safely.
     */
    suspend fun setSession(
        session: Session,
        onTenantChange: suspend (oldTenantId: String?, newTenantId: String) -> Unit,
    ) {
        val oldTenantId = _session.value?.tenantId
            ?: appPreferences.cachedTenantId.firstOrNull()
        if (oldTenantId != null && oldTenantId != session.tenantId) {
            onTenantChange(oldTenantId, session.tenantId)
        }

        secureStore.refreshToken = session.refreshToken
        appPreferences.cacheTenant(
            tenantId = session.tenantId,
            tenantSlug = session.tenantSlug,
        )
        appPreferences.setLastEmail(session.email)
        accessTokenSnapshot = session.accessToken
        _session.value = session
    }

    /** Updates only the access token (refresh-rotation paths). */
    fun updateAccessToken(token: String) {
        accessTokenSnapshot = token
        _session.value = _session.value?.copy(accessToken = token)
    }

    /** Updates only the refresh token (rotation on /refresh response). */
    fun updateRefreshToken(token: String) {
        secureStore.refreshToken = token
        _session.value = _session.value?.copy(refreshToken = token)
    }

    /** Hard wipe. Used on logout, on tenant change, and on fatal auth errors. */
    suspend fun clear() {
        accessTokenSnapshot = null
        _session.value = null
        secureStore.clear()
        appPreferences.clearSessionTraces()
    }
}

