package com.threefat.vcts.data.remote.dto

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

@Serializable
data class IntegrationDto(
    val mode: String,
    val webviewUrl: String? = null,
    val jsonSchema: JsonObject? = null,
    val uiSchema: JsonObject? = null,
    val directusCollection: String? = null,
)

@Serializable
data class IntegrationResponse(
    val integration: IntegrationDto? = null,
)

@Serializable
data class CmsItemQueueBody(
    val collection: String,
    val payload: JsonObject,
)
