package com.threefat.vcts.ui.customers

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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.threefat.vcts.R
import com.threefat.vcts.ui.location.LocationPermissionGate
import com.threefat.vcts.ui.theme.DurationEmphasized
import com.threefat.vcts.ui.theme.DurationStandard
import com.threefat.vcts.ui.theme.EaseOutCubic
import com.threefat.vcts.ui.theme.MonoFamily
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CustomersListScreen(
    onBack: () -> Unit,
    onOpenCustomer: (id: String) -> Unit,
    viewModel: CustomersListViewModel = hiltViewModel(),
) {
    val rows by viewModel.rows.collectAsStateWithLifecycle()
    val state by viewModel.state.collectAsStateWithLifecycle()
    val query by viewModel.searchQuery.collectAsStateWithLifecycle()
    val snackbar = remember { SnackbarHostState() }
    val refreshFailedMessage = stringResource(R.string.customers_load_failed)

    LaunchedEffect(state.error) {
        if (state.error == UiError.RefreshFailed) {
            snackbar.showSnackbar(
                message = refreshFailedMessage,
                withDismissAction = true,
            )
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.customers_title)) },
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
        snackbarHost = { SnackbarHost(snackbar) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        // Wrap the entire feed in a permission gate so the agent grants
        // location once and we can show distance on every row.
        LocationPermissionGate(contentPadding = padding) {
            CustomersListBody(
                padding = padding,
                rows = rows,
                query = query,
                isRefreshing = state.isRefreshing,
                onQueryChange = viewModel::setQuery,
                onRefresh = viewModel::refresh,
                onRowClick = { onOpenCustomer(it.customer.id) },
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CustomersListBody(
    padding: PaddingValues,
    rows: List<CustomerRow>,
    query: String,
    isRefreshing: Boolean,
    onQueryChange: (String) -> Unit,
    onRefresh: () -> Unit,
    onRowClick: (CustomerRow) -> Unit,
) {
    val listState = rememberLazyListState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(padding),
    ) {
        SearchField(
            value = query,
            onValueChange = onQueryChange,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 8.dp),
        )

        PullToRefreshBox(
            isRefreshing = isRefreshing,
            onRefresh = onRefresh,
            modifier = Modifier.fillMaxSize(),
        ) {
            if (rows.isEmpty() && !isRefreshing) {
                EmptyCustomers()
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
                    items(rows, key = { it.customer.id }) { row ->
                        StaggeredEntrance(visibleAt = rows.indexOf(row)) {
                            CustomerRowCard(row = row, onClick = { onRowClick(row) })
                        }
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
    // Cap the staggered delay so a 100-row list doesn't take 6 seconds
    // to fully animate in. After 6 rows the rest enter in lockstep.
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
private fun SearchField(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        modifier = modifier,
        leadingIcon = {
            Icon(Icons.Filled.Search, contentDescription = null)
        },
        placeholder = { Text(stringResource(R.string.customers_search_hint)) },
        singleLine = true,
        shape = RoundedCornerShape(14.dp),
        colors = TextFieldDefaults.colors(
            focusedContainerColor = MaterialTheme.colorScheme.surface,
            unfocusedContainerColor = MaterialTheme.colorScheme.surface,
            focusedIndicatorColor = MaterialTheme.colorScheme.primary,
            unfocusedIndicatorColor = Color.Transparent,
        ),
    )
}

@Composable
private fun CustomerRowCard(row: CustomerRow, onClick: () -> Unit) {
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
            LabeledLine(
                title = row.customer.name,
                trailing = row.customer.code,
            )
            row.customer.address?.let {
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                )
            }
            Text(
                text = stringResource(R.string.customers_assigned_to_you),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
                fontWeight = FontWeight.Medium,
            )
            Spacer(Modifier.height(2.dp))
            LabeledLine(
                title = stringResource(R.string.customers_outstanding),
                trailing = formatRupees(row.customer.outstandingBalance),
                trailingMono = true,
            )
            DistanceLine(distanceM = row.distanceM)
        }
    }
}

@Composable
private fun LabeledLine(
    title: String,
    trailing: String?,
    trailingMono: Boolean = false,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Medium,
            color = MaterialTheme.colorScheme.onSurface,
            maxLines = 1,
        )
        if (!trailing.isNullOrBlank()) {
            Text(
                text = trailing,
                style = MaterialTheme.typography.bodyMedium,
                fontFamily = if (trailingMono) MonoFamily else FontFamily.Default,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun DistanceLine(distanceM: Double?) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(
            imageVector = Icons.Filled.LocationOn,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.height(16.dp),
        )
        Text(
            text = if (distanceM == null) {
                stringResource(R.string.customers_distance_unknown)
            } else {
                formatDistance(distanceM)
            },
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            fontFamily = MonoFamily,
        )
    }
}

@Composable
private fun EmptyCustomers() {
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
                    text = stringResource(R.string.customers_empty_title),
                    style = MaterialTheme.typography.titleMedium,
                )
                Text(
                    text = stringResource(R.string.customers_empty_subtitle),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

internal fun formatRupees(amount: Double): String {
    val whole = amount.toLong()
    val sign = if (amount < 0) "-" else ""
    val absWhole = kotlin.math.abs(whole)
    val grouped = "%,d".format(absWhole)
    val cents = ((kotlin.math.abs(amount) - absWhole) * 100).roundToInt()
    return "$sign₹$grouped.${cents.toString().padStart(2, '0')}"
}

internal fun formatDistance(meters: Double): String = when {
    meters < 1_000 -> "${meters.roundToInt()} m"
    else -> String.format("%.1f km", meters / 1_000)
}
