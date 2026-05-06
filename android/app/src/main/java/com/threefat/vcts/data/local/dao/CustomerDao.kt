package com.threefat.vcts.data.local.dao

import androidx.room.Dao
import androidx.room.Query
import androidx.room.Transaction
import androidx.room.Upsert
import com.threefat.vcts.data.local.entity.CustomerEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface CustomerDao {

    @Query("SELECT * FROM customers ORDER BY name COLLATE NOCASE")
    fun observeAll(): Flow<List<CustomerEntity>>

    @Query("SELECT * FROM customers WHERE id = :id LIMIT 1")
    fun observe(id: String): Flow<CustomerEntity?>

    @Query("SELECT * FROM customers WHERE id = :id LIMIT 1")
    suspend fun get(id: String): CustomerEntity?

    @Upsert
    suspend fun upsertAll(rows: List<CustomerEntity>)

    @Query("DELETE FROM customers WHERE id NOT IN (:keep)")
    suspend fun deleteNotIn(keep: List<String>)

    @Query("DELETE FROM customers")
    suspend fun clear()

    /**
     * Replace the cache with the latest server snapshot in one transaction.
     * Done in a single Room transaction so observers see the new set
     * atomically (no flicker between empty and re-populated).
     */
    @Transaction
    suspend fun replaceAll(rows: List<CustomerEntity>) {
        if (rows.isEmpty()) {
            clear()
            return
        }
        upsertAll(rows)
        deleteNotIn(rows.map { it.id })
    }

    @Query("UPDATE customers SET outstanding_balance = outstanding_balance - :delta WHERE id = :id")
    suspend fun decrementOutstanding(id: String, delta: Double)
}
