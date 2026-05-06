package com.threefat.vcts.domain.model

/**
 * Everything the UI needs to know about the current login.
 *
 * - [accessToken] is short-lived (15 min in the JWT spec) and lives in memory
 *   only. Restarting the process forces a refresh-token round-trip.
 * - [refreshToken] is long-lived and persisted in EncryptedSharedPreferences
 *   (Keystore-wrapped). It never leaves the device unencrypted.
 *
 * The tenant display name is derived from [tenantSlug] until we ship a
 * `/api/tenant/me` endpoint with branding metadata; the slug is what the
 * server returns today (`acme`, `globex`).
 */
data class Session(
    val accessToken: String,
    val refreshToken: String,
    val userId: String,
    val email: String,
    val displayName: String?,
    val tenantId: String,
    val tenantSlug: String,
    val role: String,
)

/** Public projection - safe to expose to UI. */
data class SessionPublicInfo(
    val email: String,
    val displayName: String?,
    val tenantId: String,
    val tenantSlug: String,
    val role: String,
)

fun Session.publicInfo(): SessionPublicInfo = SessionPublicInfo(
    email = email,
    displayName = displayName,
    tenantId = tenantId,
    tenantSlug = tenantSlug,
    role = role,
)

fun String.tenantDisplay(): String =
    split('-', '_').joinToString(" ") { it.replaceFirstChar(Char::titlecase) }
