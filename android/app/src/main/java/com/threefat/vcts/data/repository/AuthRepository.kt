package com.threefat.vcts.data.repository

import com.threefat.vcts.data.preferences.AppPreferences
import com.threefat.vcts.data.remote.AuthApi
import com.threefat.vcts.data.remote.dto.ApiErrorBody
import com.threefat.vcts.data.remote.dto.LoginRequest
import com.threefat.vcts.data.session.SessionStore
import com.threefat.vcts.domain.model.Session
import kotlinx.serialization.json.Json
import retrofit2.HttpException
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Sealed result type for the login flow. The UI maps each case to a Compose
 * state so we never pass exceptions across layers.
 */
sealed interface LoginOutcome {
    data class Success(val session: Session) : LoginOutcome
    data class Failure(val reason: LoginFailure, val message: String?) : LoginOutcome
}

enum class LoginFailure { Network, InvalidCredentials, Server, Unknown }

@Singleton
class AuthRepository @Inject constructor(
    private val authApi: AuthApi,
    private val sessionStore: SessionStore,
    private val json: Json,
    private val tenantWiper: TenantDataWiper,
    private val appPreferences: AppPreferences,
) {

    suspend fun login(email: String, password: String): LoginOutcome = try {
        val installId = appPreferences.getOrCreateInstallId()
        val response = authApi.login(
            LoginRequest(
                email = email.trim(),
                password = password,
                installId = installId,
            ),
        )
        val session = Session(
            accessToken = response.accessToken,
            refreshToken = response.refreshToken,
            userId = response.user.id,
            email = response.user.email,
            displayName = response.user.name,
            tenantId = response.user.tenantId,
            tenantSlug = response.user.tenantSlug,
            role = response.user.role,
        )
        sessionStore.setSession(session) { oldTenantId, newTenantId ->
            // Cross-tenant safety: a different tenant is logging in on this
            // device. Wipe Room + ESP residue before the new identity wins.
            tenantWiper.wipeOnTenantChange(oldTenantId, newTenantId)
        }
        LoginOutcome.Success(session)
    } catch (e: HttpException) {
        val body = runCatching {
            e.response()?.errorBody()?.string()?.let { json.decodeFromString<ApiErrorBody>(it) }
        }.getOrNull()
        val reason = when (e.code()) {
            401 -> LoginFailure.InvalidCredentials
            in 500..599 -> LoginFailure.Server
            else -> LoginFailure.Unknown
        }
        LoginOutcome.Failure(reason, body?.error ?: body?.message)
    } catch (_: IOException) {
        LoginOutcome.Failure(LoginFailure.Network, null)
    } catch (e: Throwable) {
        LoginOutcome.Failure(LoginFailure.Unknown, e.message)
    }

    suspend fun logout() {
        // Best-effort revocation: when /api/auth/logout is added we'll call it
        // here. For now the refresh token is simply discarded - the server's
        // periodic cleanup job will reap expired rows.
        sessionStore.clear()
        tenantWiper.wipeOnLogout()
    }
}
