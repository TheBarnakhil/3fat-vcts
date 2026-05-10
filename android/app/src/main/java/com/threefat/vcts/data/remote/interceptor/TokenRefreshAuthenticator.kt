package com.threefat.vcts.data.remote.interceptor

import com.threefat.vcts.data.preferences.AppPreferences
import com.threefat.vcts.data.remote.AuthApi
import com.threefat.vcts.data.remote.dto.RefreshRequest
import com.threefat.vcts.data.session.SessionStore
import dagger.Lazy
import kotlinx.coroutines.runBlocking
import okhttp3.Authenticator
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
import javax.inject.Inject
import javax.inject.Singleton

/**
 * OkHttp [Authenticator] that runs **after** a 401. It does a synchronous
 * /api/auth/refresh hop using the persisted refresh token, swaps the access
 * token in [SessionStore], and replays the original request.
 *
 * Why not put refresh logic into the [AuthInterceptor]? Because OkHttp's
 * authenticator hook is the only place where multiple concurrent failed
 * calls get coalesced into one refresh attempt - the framework synchronizes
 * on us so we don't fire N parallel refreshes.
 *
 * [AuthApi] is wrapped in [dagger.Lazy] to break the cycle: AuthApi -> OkHttp
 * -> Authenticator -> AuthApi.
 */
@Singleton
class TokenRefreshAuthenticator @Inject constructor(
    private val sessionStore: SessionStore,
    private val authApi: Lazy<AuthApi>,
    private val appPreferences: AppPreferences,
) : Authenticator {

    override fun authenticate(route: Route?, response: Response): Request? {
        // Bail out on the second consecutive 401: the refresh has already
        // failed, so retrying in a loop would just stack 401s.
        if (responseCount(response) >= 2) return null

        val refreshToken = sessionStore.persistedRefreshToken ?: return null

        return synchronized(this) {
            // Re-read in case another thread already refreshed while we waited.
            val priorAccess = sessionStore.accessTokenSnapshot
            val incomingAccess = response.request.header("Authorization")
                ?.removePrefix("Bearer ")
                ?.trim()

            if (!priorAccess.isNullOrBlank() && priorAccess != incomingAccess) {
                // Another caller refreshed already - replay with the new token.
                response.request.newBuilder()
                    .header("Authorization", "Bearer $priorAccess")
                    .build()
            } else {
                val rotated = runCatching {
                    runBlocking {
                        val installId = appPreferences.getOrCreateInstallId()
                        authApi.get().refresh(
                            RefreshRequest(
                                refreshToken = refreshToken,
                                installId = installId,
                            ),
                        )
                    }
                }.getOrNull()

                if (rotated == null) {
                    // Either the refresh token is expired/revoked, or the
                    // server rejected with `device_mismatch`. Either way the
                    // session is unrecoverable - wipe and force re-login.
                    runBlocking { sessionStore.clear() }
                    null
                } else {
                    sessionStore.updateAccessToken(rotated.accessToken)
                    sessionStore.updateRefreshToken(rotated.refreshToken)
                    response.request.newBuilder()
                        .header("Authorization", "Bearer ${rotated.accessToken}")
                        .build()
                }
            }
        }
    }

    private fun responseCount(response: Response): Int {
        var result = 1
        var prior = response.priorResponse
        while (prior != null) {
            result++
            prior = prior.priorResponse
        }
        return result
    }
}
