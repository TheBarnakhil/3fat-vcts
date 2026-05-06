package com.threefat.vcts.data.remote

import com.threefat.vcts.data.remote.dto.CustomerWrapped
import com.threefat.vcts.data.remote.dto.CustomersListResponse
import retrofit2.http.GET
import retrofit2.http.Path

/**
 * Customer-side endpoints. Both routes are tenant-scoped server-side via
 * the JWT in the Authorization header (the [AuthInterceptor] stamps it),
 * so the client doesn't need to thread tenantId here.
 */
interface CustomersApi {

    @GET("/api/customers")
    suspend fun list(): CustomersListResponse

    @GET("/api/customers/{id}")
    suspend fun get(@Path("id") id: String): CustomerWrapped
}
