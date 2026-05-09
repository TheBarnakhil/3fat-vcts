package com.threefat.vcts.data.remote

import com.threefat.vcts.data.remote.dto.LocationLogsBatchRequest
import com.threefat.vcts.data.remote.dto.LocationLogsBatchResponse
import retrofit2.http.Body
import retrofit2.http.POST

/**
 * Phase 7: tracker-fix push surface. We expose a dedicated Retrofit
 * service rather than folding into [SyncApi] because the volume profile
 * (high-frequency, append-only) is different and we may later want a
 * separate base URL or rate-limit pool for it without touching the
 * collection-write path.
 */
interface LocationLogsApi {

    @POST("/api/location-logs/batch")
    suspend fun pushBatch(@Body body: LocationLogsBatchRequest): LocationLogsBatchResponse
}
