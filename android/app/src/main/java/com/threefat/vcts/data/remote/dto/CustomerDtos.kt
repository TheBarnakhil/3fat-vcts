package com.threefat.vcts.data.remote.dto

import kotlinx.serialization.Serializable

/**
 * Mirrors `web/src/app/api/customers/route.ts` (the GET projection).
 *
 * Optional fields use `?` + default null because Drizzle / Postgres can
 * return them as null and we tell `Json` to ignoreUnknownKeys so the web
 * side can add fields without breaking the parser.
 */
@Serializable
data class CustomerDto(
    val id: String,
    val code: String? = null,
    val name: String,
    val address: String? = null,
    val phone: String? = null,
    val email: String? = null,
    val category: String? = null,
    val lat: Double,
    val lng: Double,
    val geofenceRadiusM: Int,
    val outstandingBalance: Double,
    val creditLimit: Double? = null,
    val assignedAgentId: String? = null,
)

@Serializable
data class CustomersListResponse(
    val customers: List<CustomerDto>,
)

@Serializable
data class CustomerWrapped(
    val customer: CustomerDto,
)
