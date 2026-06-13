package com.threefat.vcts.data.remote

import com.threefat.vcts.data.remote.dto.IntegrationResponse
import kotlinx.serialization.json.JsonObject
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Path

/**
 * Collection integration config + Directus item proxy (tenant-scoped via JWT).
 */
interface CmsApi {

    @GET("/api/cms/integration")
    suspend fun getIntegration(): IntegrationResponse

    @POST("/api/cms/items/{collection}")
    suspend fun createItem(
        @Path("collection") collection: String,
        @Body body: JsonObject,
    ): JsonObject
}
