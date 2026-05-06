package com.threefat.vcts.data.local.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Local cache of `/api/customers`. Mirrors the columns the API actually
 * returns; we deliberately don't store fields the agent never sees on this
 * screen (e.g. updatedAt) so a future server-side rename doesn't force a
 * destructive Room migration.
 *
 * Phase 6 will turn this into the canonical store with sync_queue feeding
 * it; for Phase 5 we use it as a simple offline-readable cache so list
 * scroll is instant even on cold reopen.
 *
 * The PK is the server-issued UUID. We never insert ad-hoc rows from the
 * client; everything lands here via [CustomerDao.upsertAll] after a
 * successful network fetch.
 */
@Entity(tableName = "customers")
data class CustomerEntity(
    @PrimaryKey val id: String,
    val code: String?,
    val name: String,
    val address: String?,
    val phone: String?,
    val email: String?,
    val category: String?,
    val lat: Double,
    val lng: Double,
    @ColumnInfo(name = "geofence_radius_m") val geofenceRadiusM: Int,
    @ColumnInfo(name = "outstanding_balance") val outstandingBalance: Double,
    @ColumnInfo(name = "credit_limit") val creditLimit: Double?,
    @ColumnInfo(name = "assigned_agent_id") val assignedAgentId: String?,
    @ColumnInfo(name = "cached_at") val cachedAt: Long,
)
