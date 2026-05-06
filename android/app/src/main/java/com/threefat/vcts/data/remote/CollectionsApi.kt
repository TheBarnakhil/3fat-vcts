package com.threefat.vcts.data.remote

import com.threefat.vcts.data.remote.dto.CollectionCreateBody
import com.threefat.vcts.data.remote.dto.CollectionCreateResponse
import retrofit2.http.Body
import retrofit2.http.POST

/**
 * Collection-side endpoints. POST is rate-limited server-side; the
 * idempotency key is [CollectionCreateBody.clientUuid].
 *
 * Reversal + receipt-PDF endpoints live behind manager/auditor roles and
 * land on Android in Phase 9.
 */
interface CollectionsApi {

    @POST("/api/collections")
    suspend fun create(@Body body: CollectionCreateBody): CollectionCreateResponse
}
