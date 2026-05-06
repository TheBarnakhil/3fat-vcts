package com.threefat.vcts.ui.customers

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.GpsFixed
import androidx.compose.material.icons.filled.GpsOff
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.threefat.vcts.R
import com.threefat.vcts.domain.geo.GeofenceStatus
import com.threefat.vcts.ui.location.LocationPermissionGate
import com.threefat.vcts.ui.theme.MonoFamily
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CustomerDetailScreen(
    onBack: () -> Unit,
    onStartCollection: (customerId: String) -> Unit,
    viewModel: CustomerDetailViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.customer_detail_title)) },
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
        LocationPermissionGate(contentPadding = padding) {
            DetailBody(
                padding = padding,
                state = state,
                onStartCollection = { onStartCollection(viewModel.customerId) },
            )
        }
    }
}

@Composable
private fun DetailBody(
    padding: PaddingValues,
    state: CustomerDetailUiState,
    onStartCollection: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(padding)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        val customer = state.customer
        if (customer == null) {
            // The list screen primes the cache; if we're here without a
            // hit, the row was opened by deep-link and the network call
            // is still in flight. Show a soft loading shell.
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(stringResource(R.string.customer_locating))
            }
            return@Column
        }

        ElevatedCard(modifier = Modifier.fillMaxWidth()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                Text(
                    text = customer.name,
                    style = MaterialTheme.typography.headlineSmall,
                    fontWeight = FontWeight.Medium,
                )
                customer.code?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.labelMedium,
                        fontFamily = MonoFamily,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                customer.address?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Spacer(Modifier.height(4.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        text = stringResource(R.string.customer_outstanding),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        text = formatRupees(customer.outstandingBalance),
                        style = MaterialTheme.typography.bodyMedium,
                        fontFamily = MonoFamily,
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        text = stringResource(R.string.customer_assignment),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        text = stringResource(R.string.customers_assigned_to_you),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.primary,
                        fontWeight = FontWeight.Medium,
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(
                        text = stringResource(R.string.customer_radius),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        text = "${customer.geofenceRadiusM} m",
                        style = MaterialTheme.typography.bodyMedium,
                        fontFamily = MonoFamily,
                    )
                }
            }
        }

        GeofencePulse(state.geofence)

        Spacer(Modifier.height(4.dp))

        Button(
            onClick = onStartCollection,
            enabled = state.geofence?.canCollect == true,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            shape = MaterialTheme.shapes.medium,
        ) {
            Text(stringResource(R.string.customer_start_collection))
        }
    }
}

@Composable
private fun GeofencePulse(status: GeofenceStatus?) {
    val palette = when {
        status == null -> MaterialTheme.colorScheme.surface to MaterialTheme.colorScheme.onSurfaceVariant
        status.canCollect -> MaterialTheme.colorScheme.primaryContainer to MaterialTheme.colorScheme.onPrimaryContainer
        status.insideFence -> MaterialTheme.colorScheme.tertiaryContainer to MaterialTheme.colorScheme.onTertiaryContainer
        else -> MaterialTheme.colorScheme.errorContainer to MaterialTheme.colorScheme.onErrorContainer
    }

    Surface(
        color = palette.first,
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier
            .fillMaxWidth()
            .height(112.dp),
    ) {
        Row(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 20.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            PulseIcon(active = status?.insideFence == true, contentColor = palette.second)
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                if (status == null) {
                    Text(
                        text = stringResource(R.string.customer_locating),
                        style = MaterialTheme.typography.titleMedium,
                        color = palette.second,
                    )
                } else {
                    val distance = status.distanceM.roundToInt()
                    val headline = if (status.insideFence) {
                        stringResource(R.string.customer_distance_inside, distance)
                    } else {
                        stringResource(
                            R.string.customer_distance_outside,
                            distance,
                            status.allowedM,
                        )
                    }
                    Text(
                        text = headline,
                        style = MaterialTheme.typography.titleMedium,
                        color = palette.second,
                    )
                    if (status.accuracyM != null && !status.accuracyOk) {
                        Text(
                            text = stringResource(
                                R.string.customer_accuracy_warning,
                                status.accuracyM.roundToInt(),
                                com.threefat.vcts.domain.geo.DEFAULT_GPS_MAX_ACCURACY_M.toInt(),
                            ),
                            style = MaterialTheme.typography.bodySmall,
                            color = palette.second.copy(alpha = 0.8f),
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PulseIcon(active: Boolean, contentColor: Color) {
    val scale by rememberInfiniteTransition(label = "geofence-pulse").animateFloat(
        initialValue = 1f,
        targetValue = if (active) 1.18f else 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1_400),
            repeatMode = RepeatMode.Reverse,
        ),
        label = "scale",
    )
    Box(
        modifier = Modifier
            .size(48.dp)
            .scale(scale)
            .background(contentColor.copy(alpha = 0.12f), shape = CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(
            imageVector = when {
                !active -> Icons.Filled.GpsOff
                else -> Icons.Filled.GpsFixed
            },
            contentDescription = null,
            tint = contentColor,
        )
    }
}
