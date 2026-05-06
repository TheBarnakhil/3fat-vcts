package com.threefat.vcts.data.remote.interceptor

import com.threefat.vcts.data.session.SessionStore
import okhttp3.Interceptor
import okhttp3.Response
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Stamps `Authorization: Bearer <accessToken>` on every outbound call that
 * isn't an auth endpoint. Login + refresh must remain unauthenticated, so
 * we look at the request URL and skip stamping for those.
 *
 * Refresh-on-401 lives in [TokenRefreshAuthenticator] - keeping the two
 * concerns split means this interceptor stays trivially correct under
 * concurrent calls.
 */
@Singleton
class AuthInterceptor @Inject constructor(
    private val sessionStore: SessionStore,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val path = original.url.encodedPath
        if (path.startsWith("/api/auth/login") || path.startsWith("/api/auth/refresh")) {
            return chain.proceed(original)
        }
        val token = sessionStore.accessTokenSnapshot
        val request = if (token.isNullOrBlank()) {
            original
        } else {
            original.newBuilder()
                .header("Authorization", "Bearer $token")
                .build()
        }
        return chain.proceed(request)
    }
}
