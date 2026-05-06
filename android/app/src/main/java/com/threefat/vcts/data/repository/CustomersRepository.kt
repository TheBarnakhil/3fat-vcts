package com.threefat.vcts.data.repository

import com.threefat.vcts.data.local.dao.CustomerDao
import com.threefat.vcts.data.remote.CustomersApi
import com.threefat.vcts.domain.model.Customer
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import java.io.IOException
import javax.inject.Inject
import javax.inject.Singleton
import retrofit2.HttpException

/**
 * Customer-side repository. Reads from Room (instant, offline-friendly)
 * and refreshes from the network on demand. The list screen calls
 * [refresh] on first attach and on pull-to-refresh; the detail screen
 * calls [refreshOne] when it opens to make sure the geofence radius and
 * coordinates are current before the agent walks there.
 */
@Singleton
class CustomersRepository @Inject constructor(
    private val api: CustomersApi,
    private val dao: CustomerDao,
) {

    fun observeAll(): Flow<List<Customer>> =
        dao.observeAll().map { rows -> rows.map { it.toDomain() } }

    fun observe(id: String): Flow<Customer?> =
        dao.observe(id).map { it?.toDomain() }

    suspend fun get(id: String): Customer? = dao.get(id)?.toDomain()

    /**
     * Pulls the entire customer list from the server and replaces the
     * cache. Returns a [Result] so the UI can decide how to surface the
     * error without unwinding the stack.
     */
    suspend fun refresh(): Result<Unit> = runCatching {
        val now = System.currentTimeMillis()
        val response = api.list()
        val entities = response.customers.map { it.toEntity(now) }
        dao.replaceAll(entities)
    }.recoverCatching { throwable ->
        // Translate HTTP/IO into a typed error if needed; for the list
        // screen we only care whether it succeeded, so a simple Result
        // suffices today.
        when (throwable) {
            is IOException, is HttpException -> throw throwable
            else -> throw throwable
        }
    }

    suspend fun refreshOne(id: String): Result<Unit> = runCatching {
        val now = System.currentTimeMillis()
        val response = api.get(id)
        dao.upsertAll(listOf(response.customer.toEntity(now)))
    }

    /** Local outstanding-balance correction after a successful collection. */
    suspend fun applyCollectionLocally(customerId: String, amount: Double) {
        dao.decrementOutstanding(customerId, amount)
    }
}
