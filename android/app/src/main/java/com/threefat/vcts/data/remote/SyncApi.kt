package com.threefat.vcts.data.remote

import com.threefat.vcts.data.remote.dto.SyncPullResponse
import com.threefat.vcts.data.remote.dto.SyncPushRequest
import com.threefat.vcts.data.remote.dto.SyncPushResponse
import retrofit2.http.Body
import retrofit2.http.GET
import retrofit2.http.POST
import retrofit2.http.Query

/**
 * Retrofit interface for the Phase 6 sync endpoints.
 *
 * `/sync/push` accepts batches of up to 50 records; the server returns one
 * outcome per record so the client can reconcile each row individually.
 *
 * `/sync/pull` is a cursor-paginated delta. The client persists the
 * returned cursor in DataStore and feeds it back on the next call.
 */
interface SyncApi {

    @POST("/api/sync/push")
    suspend fun push(@Body body: SyncPushRequest): SyncPushResponse

    @GET("/api/sync/pull")
    suspend fun pull(
        @Query("since") since: String? = null,
        @Query("scope") scope: String = "all",
    ): SyncPullResponse
}
