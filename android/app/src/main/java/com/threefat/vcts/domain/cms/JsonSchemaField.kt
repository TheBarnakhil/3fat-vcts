package com.threefat.vcts.domain.cms

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

enum class JsonSchemaFieldType {
    String,
    TextArea,
    Integer,
    Number,
    Boolean,
    Enum,
    Unknown,
}

data class JsonSchemaField(
    val key: String,
    val title: String,
    val type: JsonSchemaFieldType,
    val required: Boolean,
    val enumValues: List<String> = emptyList(),
)

fun parseJsonSchemaFields(
    jsonSchema: JsonObject,
    uiSchema: JsonObject?,
): List<JsonSchemaField> {
    val properties = jsonSchema["properties"]?.jsonObject ?: return emptyList()
    val required = jsonSchema["required"]?.jsonArray
        ?.mapNotNull { it.jsonPrimitive.contentOrNull }
        ?.toSet()
        ?: emptySet()
    val order = fieldOrderFromUiSchema(uiSchema).ifEmpty { properties.keys.toList() }

    return order.mapNotNull { key ->
        val prop = properties[key]?.jsonObject ?: return@mapNotNull null
        val rawType = prop.resolveType()
        val format = prop["format"]?.jsonPrimitive?.contentOrNull
        val enumValues = prop["enum"]?.jsonArray
            ?.mapNotNull { it.jsonPrimitive.contentOrNull }
            ?: emptyList()
        val type = when {
            enumValues.isNotEmpty() -> JsonSchemaFieldType.Enum
            rawType == "integer" -> JsonSchemaFieldType.Integer
            rawType == "number" -> JsonSchemaFieldType.Number
            rawType == "boolean" -> JsonSchemaFieldType.Boolean
            rawType == "string" && format == "textarea" -> JsonSchemaFieldType.TextArea
            rawType == "string" -> JsonSchemaFieldType.String
            else -> JsonSchemaFieldType.Unknown
        }
        JsonSchemaField(
            key = key,
            title = prop["title"]?.jsonPrimitive?.contentOrNull ?: key,
            type = type,
            required = key in required,
            enumValues = enumValues,
        )
    }
}

private fun JsonObject.resolveType(): String? {
    val typeNode = this["type"] ?: return null
    return when {
        typeNode is JsonPrimitive -> typeNode.contentOrNull
        typeNode is JsonArray -> typeNode.firstOrNull { it.jsonPrimitive.contentOrNull != "null" }
            ?.jsonPrimitive?.contentOrNull
        else -> null
    }
}

private fun fieldOrderFromUiSchema(uiSchema: JsonObject?): List<String> {
    if (uiSchema == null) return emptyList()
    val out = mutableListOf<String>()
    collectControlScopes(uiSchema, out)
    return out
}

private fun collectControlScopes(node: JsonObject, out: MutableList<String>) {
    when (node["type"]?.jsonPrimitive?.contentOrNull) {
        "Control" -> {
            val scope = node["scope"]?.jsonPrimitive?.contentOrNull ?: return
            val key = scope.removePrefix("#/properties/")
            if (key.isNotBlank() && key != scope) out += key
        }
        "VerticalLayout", "HorizontalLayout", "Group" -> {
            node["elements"]?.jsonArray?.forEach { el ->
                el.jsonObject.let { collectControlScopes(it, out) }
            }
        }
    }
}

fun JsonObject.toFieldMap(): Map<String, String> =
    entries.associate { (k, v) -> k to v.jsonPrimitive.contentOrNull.orEmpty() }

fun buildJsonPayload(values: Map<String, String>, fields: List<JsonSchemaField>): JsonObject {
    val entries = fields.mapNotNull { field ->
        val raw = values[field.key]?.trim().orEmpty()
        if (raw.isEmpty() && !field.required) return@mapNotNull null
        val element = when (field.type) {
            JsonSchemaFieldType.Boolean -> JsonPrimitive(raw.equals("true", ignoreCase = true))
            JsonSchemaFieldType.Integer -> JsonPrimitive(raw.toIntOrNull() ?: 0)
            JsonSchemaFieldType.Number -> JsonPrimitive(raw.toDoubleOrNull() ?: 0.0)
            else -> JsonPrimitive(raw)
        }
        field.key to element
    }.toMap()
    return JsonObject(entries)
}

fun validateRequiredFields(
    values: Map<String, String>,
    fields: List<JsonSchemaField>,
): String? {
    for (field in fields.filter { it.required }) {
        if (values[field.key].isNullOrBlank()) {
            return field.title
        }
    }
    return null
}
