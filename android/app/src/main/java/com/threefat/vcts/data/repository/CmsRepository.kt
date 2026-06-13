package com.threefat.vcts.data.repository

import com.threefat.vcts.data.local.dao.SyncQueueDao
import com.threefat.vcts.data.local.entity.SyncQueueEntity
import com.threefat.vcts.data.remote.CmsApi
import com.threefat.vcts.data.remote.dto.CmsItemQueueBody
import com.threefat.vcts.data.remote.dto.IntegrationDto
import com.threefat.vcts.sync.SyncScheduler
import com.threefat.vcts.domain.sync.SyncStatus
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

enum class IntegrationMode { WebView, Offline, None }

data class IntegrationConfig(
    val mode: IntegrationMode,
    val webviewUrl: String? = null,
    val jsonSchema: JsonObject? = null,
    val uiSchema: JsonObject? = null,
    val directusCollection: String? = null,
)

@Singleton
class CmsRepository @Inject constructor(
    private val cmsApi: CmsApi,
    private val queueDao: SyncQueueDao,
    private val json: Json,
    private val syncScheduler: SyncScheduler,
) {

    suspend fun fetchIntegration(): IntegrationConfig? {
        val dto = cmsApi.getIntegration().integration ?: return null
        return dto.toConfig()
    }

    suspend fun queueItemResponse(
        collection: String,
        payload: JsonObject,
        clientUuid: String = UUID.randomUUID().toString(),
    ) {
        val body = CmsItemQueueBody(collection = collection, payload = payload)
        val now = System.currentTimeMillis()
        queueDao.upsert(
            SyncQueueEntity(
                clientUuid = clientUuid,
                payloadType = SyncQueueEntity.PAYLOAD_CMS_ITEM_CREATE,
                body = json.encodeToString(CmsItemQueueBody.serializer(), body),
                status = SyncStatus.PENDING.wire,
                attempts = 0,
                lastErrorCode = null,
                lastErrorMessage = null,
                enqueuedAt = now,
                lastTriedAt = null,
            ),
        )
        syncScheduler.requestImmediate()
    }

    private fun IntegrationDto.toConfig(): IntegrationConfig {
        val mode = when (mode) {
            "webview" -> IntegrationMode.WebView
            "offline" -> IntegrationMode.Offline
            else -> IntegrationMode.None
        }
        return IntegrationConfig(
            mode = mode,
            webviewUrl = webviewUrl,
            jsonSchema = jsonSchema,
            uiSchema = uiSchema,
            directusCollection = directusCollection,
        )
    }
}
