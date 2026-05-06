package com.threefat.vcts.ui.receipt

import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material3.Button
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.threefat.vcts.R
import com.threefat.vcts.domain.model.CollectionRecord
import com.threefat.vcts.domain.model.Customer
import com.threefat.vcts.domain.sync.SyncStatus
import com.threefat.vcts.ui.theme.DurationEmphasized
import com.threefat.vcts.ui.theme.EaseOutCubic
import com.threefat.vcts.ui.theme.MonoFamily
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReceiptPreviewScreen(
    onDone: () -> Unit,
    viewModel: ReceiptPreviewViewModel = hiltViewModel(),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.receipt_title)) },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = MaterialTheme.colorScheme.background,
                ),
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Body(padding = padding, state = state, onDone = onDone)
    }
}

@Composable
private fun Body(padding: PaddingValues, state: ReceiptUiState, onDone: () -> Unit) {
    val collection = state.collection
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(padding)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        StatusBanner(
            replayed = state.replayed,
            syncStatus = collection?.syncStatus ?: SyncStatus.SYNCED,
        )

        if (collection != null) {
            ReceiptCard(
                tenantSlug = state.tenantSlug,
                collection = collection,
                customer = state.customer,
            )
        }

        Spacer(Modifier.weight(1f))

        Button(
            onClick = onDone,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            shape = MaterialTheme.shapes.medium,
        ) {
            Text(stringResource(R.string.receipt_done))
        }
    }
}

@Composable
private fun StatusBanner(replayed: Boolean, syncStatus: SyncStatus) {
    val (containerColour, contentColour, headline, sub) = when {
        syncStatus == SyncStatus.PENDING || syncStatus == SyncStatus.IN_FLIGHT ->
            BannerSpec(
                container = MaterialTheme.colorScheme.secondaryContainer,
                content = MaterialTheme.colorScheme.onSecondaryContainer,
                headline = "Recorded · syncing",
                sub = "We'll finalise the receipt as soon as you're back online.",
            )
        syncStatus == SyncStatus.FAILED ->
            BannerSpec(
                container = MaterialTheme.colorScheme.errorContainer,
                content = MaterialTheme.colorScheme.onErrorContainer,
                headline = "Sync failed",
                sub = "The server rejected this submission. Open the queue to inspect.",
            )
        replayed ->
            BannerSpec(
                container = MaterialTheme.colorScheme.tertiaryContainer,
                content = MaterialTheme.colorScheme.onTertiaryContainer,
                headline = "Already recorded",
                sub = null,
            )
        else ->
            BannerSpec(
                container = MaterialTheme.colorScheme.primaryContainer,
                content = MaterialTheme.colorScheme.onPrimaryContainer,
                headline = "Collection recorded",
                sub = null,
            )
    }

    Surface(
        color = containerColour,
        shape = RoundedCornerShape(20.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            // Tiny celebratory entrance for fresh successes; replayed /
            // pending banners use the same animation but the icon shape
            // changes via syncStatus so it doesn't read as a "win".
            AnimatedVisibility(
                visible = true,
                enter = scaleIn(animationSpec = tween(DurationEmphasized, easing = EaseOutCubic)) +
                    fadeIn(animationSpec = tween(DurationEmphasized)),
                exit = scaleOut() + fadeOut(),
            ) {
                Icon(
                    imageVector = Icons.Filled.CheckCircle,
                    contentDescription = null,
                    tint = contentColour,
                )
            }
            Column {
                Text(
                    text = headline,
                    style = MaterialTheme.typography.titleMedium,
                    color = contentColour,
                )
                val subline = sub ?: if (replayed) {
                    stringResource(R.string.receipt_replayed_notice)
                } else null
                if (subline != null) {
                    Text(
                        text = subline,
                        style = MaterialTheme.typography.bodySmall,
                        color = contentColour.copy(alpha = 0.85f),
                    )
                }
            }
        }
    }
}

private data class BannerSpec(
    val container: androidx.compose.ui.graphics.Color,
    val content: androidx.compose.ui.graphics.Color,
    val headline: String,
    val sub: String?,
)

@Composable
private fun ReceiptCard(
    tenantSlug: String,
    collection: CollectionRecord,
    customer: Customer?,
) {
    ElevatedCard(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text(
                text = "VCTS Receipt",
                style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.SemiBold,
            )
            Text(
                text = "Tenant: $tenantSlug",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(
                text = collection.receiptNo ?: "Receipt # pending",
                style = MaterialTheme.typography.titleMedium,
                fontFamily = MonoFamily,
                color = if (collection.receiptNo != null) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            )
            HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))

            ReceiptLine("Customer", customer?.name ?: collection.customerId)
            customer?.code?.let { ReceiptLine("Code", it, mono = true) }
            ReceiptLine("Amount", formatRupees(collection.amount), mono = true, emphasised = true)
            ReceiptLine("Mode", collection.paymentMode.display)
            collection.refNo?.let { ReceiptLine("Reference", it, mono = true) }
            collection.chequeDate?.let { ReceiptLine("Cheque date", it, mono = true) }
            ReceiptLine("Date", collection.collectedAtIso)
            ReceiptLine(
                label = "GPS",
                value = "%.5f, %.5f".format(collection.collectionLat, collection.collectionLng),
                mono = true,
            )
            collection.gpsAccuracyM?.let {
                ReceiptLine("Accuracy", "${it.roundToInt()} m", mono = true)
            }
            collection.remarks?.takeIf { it.isNotBlank() }?.let {
                ReceiptLine("Remarks", it)
            }
        }
    }
}

@Composable
private fun ReceiptLine(
    label: String,
    value: String,
    mono: Boolean = false,
    emphasised: Boolean = false,
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.Top,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = value,
            style = if (emphasised) MaterialTheme.typography.titleMedium
            else MaterialTheme.typography.bodyMedium,
            fontFamily = if (mono) MonoFamily else null,
            color = MaterialTheme.colorScheme.onSurface,
            modifier = Modifier.padding(start = 12.dp),
        )
    }
}

private fun formatRupees(amount: Double): String {
    val nf = NumberFormat.getInstance(Locale.US)
    nf.minimumFractionDigits = 2
    nf.maximumFractionDigits = 2
    return "₹" + nf.format(amount)
}

