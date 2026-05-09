package com.threefat.vcts.data.repository

import com.threefat.vcts.data.local.entity.CollectionEntity
import com.threefat.vcts.data.local.entity.CustomerEntity
import com.threefat.vcts.data.remote.dto.CollectionRowDto
import com.threefat.vcts.data.remote.dto.CustomerDto
import com.threefat.vcts.data.remote.dto.SyncCollectionDto
import com.threefat.vcts.data.remote.dto.SyncCustomerDto
import com.threefat.vcts.domain.model.CollectionRecord
import com.threefat.vcts.domain.model.Customer
import com.threefat.vcts.domain.model.PaymentMode
import com.threefat.vcts.domain.sync.SyncStatus

internal fun CustomerDto.toEntity(now: Long): CustomerEntity = CustomerEntity(
    id = id,
    code = code,
    name = name,
    address = address,
    phone = phone,
    email = email,
    category = category,
    lat = lat,
    lng = lng,
    geofenceRadiusM = geofenceRadiusM,
    outstandingBalance = outstandingBalance,
    creditLimit = creditLimit,
    assignedAgentId = assignedAgentId,
    cachedAt = now,
)

internal fun SyncCustomerDto.toEntity(now: Long): CustomerEntity = CustomerEntity(
    id = id,
    code = code,
    name = name,
    address = address,
    phone = phone,
    email = email,
    category = category,
    lat = lat,
    lng = lng,
    geofenceRadiusM = geofenceRadiusM,
    outstandingBalance = outstandingBalance,
    creditLimit = creditLimit,
    assignedAgentId = assignedAgentId,
    cachedAt = now,
)

internal fun CustomerEntity.toDomain(): Customer = Customer(
    id = id,
    code = code,
    name = name,
    address = address,
    phone = phone,
    email = email,
    category = category,
    lat = lat,
    lng = lng,
    geofenceRadiusM = geofenceRadiusM,
    outstandingBalance = outstandingBalance,
    creditLimit = creditLimit,
    assignedAgentId = assignedAgentId,
)

/**
 * Map an authoritative server row into the local cache. Forces
 * `sync_status = "synced"` because by definition a server-confirmed row
 * is in sync.
 */
internal fun CollectionRowDto.toEntity(now: Long): CollectionEntity = CollectionEntity(
    id = id,
    clientUuid = clientUuid ?: "",
    customerId = customerId,
    agentId = agentId,
    receiptNo = receiptNo,
    amount = amount,
    paymentMode = paymentMode,
    refNo = refNo,
    chequeDate = chequeDate,
    remarks = remarks,
    collectionLat = collectionLat,
    collectionLng = collectionLng,
    gpsAccuracyM = gpsAccuracyM,
    collectedAt = collectedAt,
    supervisorReview = supervisorReview,
    syncStatus = SyncStatus.SYNCED.wire,
    cachedAt = now,
    photoUrl = photoUrl,
    signatureUrl = signatureUrl,
)

internal fun SyncCollectionDto.toEntity(now: Long): CollectionEntity = CollectionEntity(
    id = id,
    clientUuid = clientUuid ?: "",
    customerId = customerId,
    agentId = agentId,
    receiptNo = receiptNo,
    amount = amount,
    paymentMode = paymentMode,
    refNo = refNo,
    chequeDate = chequeDate,
    remarks = remarks,
    collectionLat = collectionLat,
    collectionLng = collectionLng,
    gpsAccuracyM = gpsAccuracyM,
    collectedAt = collectedAt,
    supervisorReview = supervisorReview,
    syncStatus = SyncStatus.SYNCED.wire,
    cachedAt = now,
    photoUrl = photoUrl,
    signatureUrl = signatureUrl,
)

internal fun CollectionEntity.toDomain(): CollectionRecord = CollectionRecord(
    id = id,
    clientUuid = clientUuid.ifEmpty { null },
    customerId = customerId,
    agentId = agentId,
    receiptNo = receiptNo,
    amount = amount,
    paymentMode = PaymentMode.fromWire(paymentMode) ?: PaymentMode.Cash,
    refNo = refNo,
    chequeDate = chequeDate,
    remarks = remarks,
    collectionLat = collectionLat,
    collectionLng = collectionLng,
    gpsAccuracyM = gpsAccuracyM,
    collectedAtIso = collectedAt,
    supervisorReview = supervisorReview,
    syncStatus = SyncStatus.fromWire(syncStatus),
    photoUrl = photoUrl,
    signatureUrl = signatureUrl,
    photoLocalPath = photoLocalPath,
    signatureLocalPath = signatureLocalPath,
)
