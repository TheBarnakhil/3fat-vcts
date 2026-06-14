package com.threefat.vcts.ui.queue

import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.CloudDone
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material3.Button
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.threefat.vcts.R
import com.threefat.vcts.data.local.entity.SyncQueueEntity
import com.threefat.vcts.domain.sync.SyncStatus
import com.threefat.vcts.ui.theme.MonoFamily
import java.text.DateFormat
import java.util.Date

/**
 * Offline queue admin surface for the agent.
 *
 * Shows every row in `sync_queue` with its current status, attempt
 * count, and last error. The "Retry all" CTA pokes the [SyncScheduler]
 * which dedupes against any in-flight worker, so spamming the button
 * doesn't fan out to dozens of POSTs.
 *
 * Permanently rejected rows, or rows that hit the retry ceiling, expose a
 * discard action. Collection rows also drop the optimistic local collection;
 * CMS integration rows only remove the queue entry.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OfflineQueueScreen(
    onBack: () -> Unit,
    viewModel: OfflineQueueViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.queue_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(R.string.common_back),
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Body(
            padding = padding,
            state = state,
            onRetryAll = viewModel::onRetryAllClicked,
            onDiscard = viewModel::onDiscardClicked,
        )
    }
}

@Composable
private fun Body(
    padding: PaddingValues,
    state: OfflineQueueUiState,
    onRetryAll: () -> Unit,
    onDiscard: (clientUuid: String, payloadType: String) -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(padding)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        LastSyncFooter(epochMillis = state.lastSyncAtEpochMillis)

        if (state.rows.isEmpty()) {
            EmptyState()
        } else {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.End,
            ) {
                Button(onClick = onRetryAll, shape = MaterialTheme.shapes.medium) {
                    Text(stringResource(R.string.queue_retry_all))
                }
            }
            LazyColumn(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items(state.rows, key = { it.clientUuid }) { row ->
                    QueueRowCard(
                        row = row,
                        onDiscard = { onDiscard(row.clientUuid, row.payloadType) },
                    )
                }
            }
        }
    }
}

@Composable
private fun LastSyncFooter(epochMillis: Long?) {
    val text = if (epochMillis == null) {
        stringResource(R.string.queue_never_synced)
    } else {
        val fmt = remember { DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT) }
        stringResource(R.string.queue_last_synced, fmt.format(Date(epochMillis)))
    }
    Surface(
        color = MaterialTheme.colorScheme.surfaceVariant,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.CloudDone,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp),
            )
            Text(
                text = text,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun EmptyState() {
    Box(
        modifier = Modifier
            .fillMaxSize()
            .padding(top = 48.dp),
        contentAlignment = Alignment.TopCenter,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Icon(
                imageVector = Icons.Filled.CloudDone,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(48.dp),
            )
            Text(
                text = stringResource(R.string.queue_empty_title),
                style = MaterialTheme.typography.titleMedium,
            )
            Text(
                text = stringResource(R.string.queue_empty_subtitle),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun QueueRowCard(row: OfflineQueueRow, onDiscard: () -> Unit) {
    // Subtle entrance so the list doesn't feel static when WorkManager
    // flips a row's status under the user.
    androidx.compose.animation.AnimatedVisibility(
        visible = true,
        enter = slideInVertically(animationSpec = tween(220)) { it / 6 } +
            fadeIn(animationSpec = tween(240)),
    ) {
        ElevatedCard(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = queuePayloadLabel(row.payloadType),
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    StatusChip(status = row.status)
                }
                row.cmsCollection?.let { collection ->
                    Text(
                        text = stringResource(R.string.queue_cms_collection, collection),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurface,
                    )
                }
                Text(
                    text = row.clientUuid,
                    style = MaterialTheme.typography.bodySmall,
                    fontFamily = MonoFamily,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Spacer(Modifier.height(2.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        text = stringResource(R.string.queue_attempt_count, row.attempts),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = formatTimestamp(row.enqueuedAtEpochMillis),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (row.lastErrorMessage != null || row.lastErrorCode != null) {
                    Surface(
                        color = MaterialTheme.colorScheme.errorContainer,
                        shape = RoundedCornerShape(12.dp),
                    ) {
                        Column(modifier = Modifier.padding(12.dp)) {
                            row.lastErrorCode?.let {
                                Text(
                                    text = it,
                                    style = MaterialTheme.typography.labelMedium,
                                    fontWeight = FontWeight.SemiBold,
                                    color = MaterialTheme.colorScheme.onErrorContainer,
                                )
                            }
                            row.lastErrorMessage?.let {
                                Text(
                                    text = it,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onErrorContainer,
                                )
                            }
                        }
                    }
                }
                if (row.canDiscard) {
                    Button(
                        onClick = onDiscard,
                        modifier = Modifier.fillMaxWidth(),
                        shape = MaterialTheme.shapes.medium,
                    ) {
                        Icon(
                            imageVector = Icons.Filled.DeleteOutline,
                            contentDescription = null,
                            modifier = Modifier.size(18.dp),
                        )
                        Text(stringResource(R.string.queue_discard))
                    }
                }
            }
        }
    }
}

@Composable
private fun StatusChip(status: SyncStatus) {
    val (label, container, content) = when (status) {
        SyncStatus.PENDING -> Triple(
            stringResource(R.string.queue_status_pending),
            MaterialTheme.colorScheme.secondaryContainer,
            MaterialTheme.colorScheme.onSecondaryContainer,
        )
        SyncStatus.IN_FLIGHT -> Triple(
            stringResource(R.string.queue_status_in_flight),
            MaterialTheme.colorScheme.tertiaryContainer,
            MaterialTheme.colorScheme.onTertiaryContainer,
        )
        SyncStatus.FAILED -> Triple(
            stringResource(R.string.queue_status_failed),
            MaterialTheme.colorScheme.errorContainer,
            MaterialTheme.colorScheme.onErrorContainer,
        )
        SyncStatus.SYNCED -> Triple(
            stringResource(R.string.queue_status_synced),
            MaterialTheme.colorScheme.primaryContainer,
            MaterialTheme.colorScheme.onPrimaryContainer,
        )
    }
    Surface(
        color = container,
        shape = RoundedCornerShape(12.dp),
    ) {
        Text(
            text = label,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
            style = MaterialTheme.typography.labelMedium,
            color = content,
        )
    }
}

private fun formatTimestamp(epochMillis: Long): String {
    val fmt = DateFormat.getTimeInstance(DateFormat.SHORT)
    return fmt.format(Date(epochMillis))
}

@Composable
private fun queuePayloadLabel(payloadType: String): String = when (payloadType) {
    SyncQueueEntity.PAYLOAD_COLLECTION_CREATE ->
        stringResource(R.string.queue_type_collection)
    SyncQueueEntity.PAYLOAD_CMS_ITEM_CREATE ->
        stringResource(R.string.queue_type_cms)
    else -> payloadType
}
