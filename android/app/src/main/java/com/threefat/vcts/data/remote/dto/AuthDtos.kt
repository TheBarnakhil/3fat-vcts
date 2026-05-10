package com.threefat.vcts.data.remote.dto

import kotlinx.serialization.Serializable

/**
 * DTOs that mirror the web/src/app/api/auth/ responses. Field names are kept
 * in lock-step with the web side - if the server contract changes, both sides
 * must be updated together.
 */

@Serializable
data class LoginRequest(
    val email: String,
    val password: String,
    val deviceId: String? = null,
    /**
     * Phase 10 (Track B). Stable per-install UUID generated on first
     * launch and persisted across logouts. The server hashes this and
     * stores the digest on the issued refresh-token row; the same hash
     * goes into the access token's `dfp` claim.
     */
    val installId: String? = null,
)

@Serializable
data class RefreshRequest(
    val refreshToken: String,
    /**
     * Phase 10 (Track B). Must match the installId used at login or the
     * server will reject the refresh with `device_mismatch` (HTTP 401).
     * Optional only so refresh rows minted before Track B keep working
     * during the rollout window.
     */
    val installId: String? = null,
)

@Serializable
data class AuthUser(
    val id: String,
    val email: String,
    val name: String? = null,
    val role: String,
    val tenantId: String,
    val tenantSlug: String,
)

@Serializable
data class LoginResponse(
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: Int,
    val user: AuthUser,
)

@Serializable
data class RefreshResponse(
    val accessToken: String,
    val refreshToken: String,
    val expiresIn: Int,
)

@Serializable
data class ApiErrorBody(
    val error: String? = null,
    val message: String? = null,
    val code: String? = null,
)
