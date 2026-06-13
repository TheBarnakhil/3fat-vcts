package com.threefat.vcts.ui.cms

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.threefat.vcts.R
import com.threefat.vcts.domain.cms.JsonSchemaField
import com.threefat.vcts.domain.cms.JsonSchemaFieldType

@Composable
fun JsonSchemaForm(
    fields: List<JsonSchemaField>,
    values: Map<String, String>,
    onValueChange: (key: String, value: String) -> Unit,
    errorFieldTitle: String? = null,
    modifier: Modifier = Modifier,
) {
    if (fields.isEmpty()) return

    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Text(
            text = stringResource(R.string.cms_form_section_title),
            style = MaterialTheme.typography.titleSmall,
        )
        Text(
            text = stringResource(R.string.cms_form_section_subtitle),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        fields.forEach { field ->
            val hasError = errorFieldTitle == field.title
            when (field.type) {
                JsonSchemaFieldType.Boolean -> {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            text = field.title + if (field.required) " *" else "",
                            style = MaterialTheme.typography.bodyLarge,
                        )
                        Switch(
                            checked = values[field.key].equals("true", ignoreCase = true),
                            onCheckedChange = { checked ->
                                onValueChange(field.key, checked.toString())
                            },
                        )
                    }
                }
                JsonSchemaFieldType.Enum -> {
                    Text(
                        text = field.title + if (field.required) " *" else "",
                        style = MaterialTheme.typography.labelLarge,
                    )
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        field.enumValues.forEach { option ->
                            FilterChip(
                                selected = values[field.key] == option,
                                onClick = { onValueChange(field.key, option) },
                                label = { Text(option) },
                            )
                        }
                    }
                    if (hasError) {
                        FieldErrorText()
                    }
                }
                JsonSchemaFieldType.TextArea -> {
                    OutlinedTextField(
                        value = values[field.key].orEmpty(),
                        onValueChange = { onValueChange(field.key, it) },
                        label = { Text(field.title + if (field.required) " *" else "") },
                        isError = hasError,
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(96.dp),
                    )
                }
                JsonSchemaFieldType.Integer -> {
                    OutlinedTextField(
                        value = values[field.key].orEmpty(),
                        onValueChange = { onValueChange(field.key, it.filter { c -> c.isDigit() || c == '-' }) },
                        label = { Text(field.title + if (field.required) " *" else "") },
                        singleLine = true,
                        isError = hasError,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                JsonSchemaFieldType.Number -> {
                    OutlinedTextField(
                        value = values[field.key].orEmpty(),
                        onValueChange = { raw ->
                            val sanitized = raw.filterIndexed { _, c -> c.isDigit() || c == '.' || c == '-' }
                                .let {
                                    val firstDot = it.indexOf('.')
                                    if (firstDot < 0) it else it.substring(0, firstDot + 1) +
                                        it.substring(firstDot + 1).filter { ch -> ch.isDigit() }
                                }
                            onValueChange(field.key, sanitized)
                        },
                        label = { Text(field.title + if (field.required) " *" else "") },
                        singleLine = true,
                        isError = hasError,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                JsonSchemaFieldType.String,
                JsonSchemaFieldType.Unknown,
                -> {
                    OutlinedTextField(
                        value = values[field.key].orEmpty(),
                        onValueChange = { onValueChange(field.key, it) },
                        label = { Text(field.title + if (field.required) " *" else "") },
                        singleLine = true,
                        isError = hasError,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}

@Composable
private fun FieldErrorText() {
    Text(
        text = stringResource(R.string.cms_form_field_required),
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.error,
        modifier = Modifier.padding(top = 4.dp),
    )
}
