package com.threefat.vcts.ui.collections

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
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
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.threefat.vcts.R
import com.threefat.vcts.domain.sync.SyncStatus
import com.threefat.vcts.ui.theme.DurationEmphasized
import com.threefat.vcts.ui.theme.DurationStandard
import com.threefat.vcts.ui.theme.EaseOutCubic
import java.text.NumberFormat
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CollectionsListScreen(
    onBack: () -> Unit,
    onOpenReceipt: (id: String) -> Unit,
    viewModel: CollectionsListViewModel = hiltViewModel(),
) {
    val rows by viewModel.rows.collectAsStateWithLifecycle()
    val state by viewModel.state.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.collections_title)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
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
        CollectionsListBody(
            padding = padding,
            rows = rows,
            isRefreshing = state.isRefreshing,
            onRefresh = viewModel::refresh,
            onRowClick = { onOpenReceipt(it.record.id) },
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CollectionsListBody(
    padding: PaddingValues,
    rows: List<CollectionRow>,
    isRefreshing: Boolean,
    onRefresh: () -> Unit,
    onRowClick: (CollectionRow) -> Unit,
) {
    val listState = rememberLazyListState()

    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = onRefresh,
        modifier = Modifier
            .fillMaxSize()
            .padding(padding),
    ) {
        if (rows.isEmpty() && !isRefreshing) {
            EmptyCollections()
        } else {
            LazyColumn(
                state = listState,
                contentPadding = PaddingValues(
                    start = 16.dp,
                    end = 16.dp,
                    top = 4.dp,
                    bottom = 24.dp,
                ),
                verticalArrangement = Arrangement.spacedBy(10.dp),
                modifier = Modifier.fillMaxSize(),
            ) {
                items(rows, key = { it.record.id }) { row ->
                    StaggeredEntrance(visibleAt = rows.indexOf(row)) {
                        CollectionRowCard(row = row, onClick = { onRowClick(row) })
                    }
                }
            }
        }
    }
}

@Composable
private fun StaggeredEntrance(
    visibleAt: Int,
    content: @Composable () -> Unit,
) {
    val delayMs = (visibleAt.coerceAtMost(6) * 60)
    AnimatedVisibility(
        visible = true,
        enter = fadeIn(animationSpec = tween(DurationEmphasized, delayMs)) +
            slideInVertically(
                animationSpec = tween(DurationEmphasized, delayMs, EaseOutCubic),
                initialOffsetY = { it / 6 },
            ),
        exit = fadeOut(animationSpec = tween(DurationStandard)),
    ) {
        content()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CollectionRowCard(row: CollectionRow, onClick: () -> Unit) {
    val record = row.record
    ElevatedCard(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = MaterialTheme.shapes.medium,
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = row.customerName,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface,
                    maxLines = 1,
                    modifier = Modifier.weight(1f),
                )
                StatusChip(syncStatus = record.syncStatus)
            }
            Text(
                text = record.receiptNo ?: stringResource(R.string.collections_receipt_pending),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
            ) {
                Text(
                    text = formatRupees(record.amount),
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    text = record.paymentMode.display,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Text(
                text = record.collectedAtIso,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun StatusChip(syncStatus: SyncStatus) {
    val (label, color) = when (syncStatus) {
        SyncStatus.SYNCED -> Pair(
            stringResource(R.string.collection_status_synced),
            MaterialTheme.colorScheme.primary,
        )
        SyncStatus.IN_FLIGHT -> Pair(
            stringResource(R.string.collection_status_syncing),
            MaterialTheme.colorScheme.tertiary,
        )
        SyncStatus.PENDING -> Pair(
            stringResource(R.string.collection_status_pending),
            MaterialTheme.colorScheme.onSurfaceVariant,
        )
        SyncStatus.FAILED -> Pair(
            stringResource(R.string.collection_status_failed),
            MaterialTheme.colorScheme.error,
        )
    }
    Text(
        text = label,
        style = MaterialTheme.typography.labelSmall,
        color = color,
        fontWeight = FontWeight.Medium,
    )
}

@Composable
private fun EmptyCollections() {
    Box(
        modifier = Modifier.fillMaxSize(),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            color = MaterialTheme.colorScheme.surface,
            shape = MaterialTheme.shapes.medium,
            modifier = Modifier
                .fillMaxWidth()
                .padding(24.dp),
        ) {
            Column(
                modifier = Modifier.padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                Text(
                    text = stringResource(R.string.collections_empty_title),
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(
                    text = stringResource(R.string.collections_empty_subtitle),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private fun formatRupees(amount: Double): String {
    val fmt = NumberFormat.getNumberInstance(Locale("en", "IN"))
    fmt.minimumFractionDigits = 2
    fmt.maximumFractionDigits = 2
    val sign = if (amount < 0) "-" else ""
    return "$sign\u20B9${fmt.format(kotlin.math.abs(amount))}"
}
