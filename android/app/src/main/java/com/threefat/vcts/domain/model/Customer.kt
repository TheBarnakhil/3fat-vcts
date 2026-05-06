package com.threefat.vcts.domain.model

/**
 * Customer model used by the UI. Distinct from the network DTO and the
 * Room entity so that a server schema or a cache schema change doesn't
 * ripple into composables. Mappers live in
 * `data/repository/mappers.kt`.
 */
data class Customer(
    val id: String,
    val code: String?,
    val name: String,
    val address: String?,
    val phone: String?,
    val email: String?,
    val category: String?,
    val lat: Double,
    val lng: Double,
    val geofenceRadiusM: Int,
    val outstandingBalance: Double,
    val creditLimit: Double?,
    val assignedAgentId: String?,
)
