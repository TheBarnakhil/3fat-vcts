package com.threefat.vcts.data.sync

import com.threefat.vcts.data.local.dao.CollectionDao
import com.threefat.vcts.data.local.dao.CustomerDao
import com.threefat.vcts.data.preferences.AppPreferences
import com.threefat.vcts.data.remote.SyncApi
import com.threefat.vcts.data.repository.toEntity
import com.threefat.vcts.domain.sync.PullSummary
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.flow.first

/**
 * Pulls deltas from `/api/sync/pull` and merges them into the local Room
 * cache. Cursor lives in [AppPreferences] so a fresh login picks up where
 * the previous session left off (the cursor is wiped by
 * [com.threefat.vcts.data.repository.TenantDataWiper] on logout / tenant
 * change, forcing a full snapshot on the next call).
 *
 * We never delete locally cached rows in response to a pull - the server
 * does not send tombstones in this phase. If a customer is unassigned
 * from an agent, the next refresh-from-/api/customers will reconcile it.
 */
@Singleton
class PullSync @Inject constructor(
    private val syncApi: SyncApi,
    private val appPreferences: AppPreferences,
    private val customerDao: CustomerDao,
    private val collectionDao: CollectionDao,
) {

    suspend fun pullOnce(): PullSummary {
        val since = appPreferences.syncPullCursor.first()
        val response = syncApi.pull(since = since, scope = "all")
        val now = System.currentTimeMillis()

        if (response.customers.isNotEmpty()) {
            customerDao.upsertAll(response.customers.map { it.toEntity(now) })
        }
        if (response.collections.isNotEmpty()) {
            for (dto in response.collections) {
                // The pull surface is authoritative; if the server sent
                // a row we either don't have locally or have only as a
                // pending optimistic copy, swap in the canonical version
                // keyed by clientUuid when possible.
                val clientUuid = dto.clientUuid
                if (clientUuid != null) {
                    val existing = collectionDao.findByClientUuid(clientUuid)
                    if (existing != null && existing.id != dto.id) {
                        collectionDao.replaceLocalWithServer(
                            clientUuid = clientUuid,
                            server = dto.toEntity(now),
                        )
                        continue
                    }
                }
                collectionDao.upsert(dto.toEntity(now))
            }
        }

        // Persist the new cursor so the next call is incremental even
        // across process restarts.
        appPreferences.setSyncPullCursor(response.cursor)

        return PullSummary(
            customersUpserted = response.customers.size,
            collectionsUpserted = response.collections.size,
            cursor = response.cursor,
            hasMore = response.hasMore,
        )
    }
}
