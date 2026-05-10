package com.threefat.vcts.data.remote

import com.threefat.vcts.data.remote.dto.ReceiptAssetsResponse
import okhttp3.ResponseBody
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query
import retrofit2.http.Streaming

/**
 * Phase 10 / Track C1.
 *
 * `assets()` returns presigned GET URLs + branding/agent metadata so
 * the on-device renderer can produce a PDF that matches the web
 * template. `staticMap()` proxies Google Static Maps; the Maps API
 * key never leaves the server.
 *
 * Both endpoints are auth-protected. The Maps proxy shares the
 * `geocode` rate-limit bucket on the server.
 */
interface ReceiptAssetsApi {

    @GET("/api/collections/{id}/receipt-assets")
    suspend fun assets(@Path("id") collectionId: String): ReceiptAssetsResponse

    @Streaming
    @GET("/api/maps/static")
    suspend fun staticMap(
        @Query("lat") lat: Double,
        @Query("lng") lng: Double,
        @Query("zoom") zoom: Int = 16,
        @Query("w") widthPx: Int = 320,
        @Query("h") heightPx: Int = 220,
        @Query("scale") scale: Int = 2,
    ): ResponseBody
}
