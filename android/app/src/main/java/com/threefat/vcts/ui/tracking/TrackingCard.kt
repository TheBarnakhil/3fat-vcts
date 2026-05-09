package com.threefat.vcts.ui.tracking

import android.Manifest
import android.text.format.DateUtils
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.threefat.vcts.R

/**
 * Dashboard card that lets the agent flip "active duty" tracking on/off,
 * shows the most recent fix timestamp, and surfaces how many fixes are
 * still waiting to push.
 *
 * Permission flow:
 *   1. Switch flipped on -> request fine-location if missing.
 *   2. Once granted -> repository is enabled (service starts).
 *   3. If background-location is missing on Android 10+ we surface the
 *      rationale dialog so the user can grant it. The service will keep
 *      running while the screen is on either way; the dialog is purely
 *      to enable continued tracking when the screen turns off.
 */
@Composable
fun TrackingCard(
    enabled: Boolean,
    lastFixAt: Long?,
    pendingCount: Int,
    hasBackgroundPermission: Boolean,
    onToggle: (enabled: Boolean) -> Unit,
) {
    val context = LocalContext.current
    var showBackgroundRationale by remember { mutableStateOf(false) }

    val foregroundLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestMultiplePermissions(),
    ) { result ->
        val granted = result[Manifest.permission.ACCESS_FINE_LOCATION] == true
        if (granted) {
            onToggle(true)
            // Trigger the background-permission rationale on the same
            // gesture so the agent doesn't have to find a second toggle.
            if (!hasBackgroundPermission) {
                showBackgroundRationale = true
            }
        }
    }

    BackgroundLocationRationaleDialog(
        visible = showBackgroundRationale,
        onDismiss = { showBackgroundRationale = false },
    )

    ElevatedCard(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(20.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Surface(
                color = if (enabled) {
                    MaterialTheme.colorScheme.primaryContainer
                } else {
                    MaterialTheme.colorScheme.surfaceVariant
                },
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.size(48.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(
                        imageVector = Icons.Filled.LocationOn,
                        contentDescription = null,
                        tint = if (enabled) {
                            MaterialTheme.colorScheme.onPrimaryContainer
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    )
                }
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = stringResource(R.string.tracking_card_title),
                    style = MaterialTheme.typography.titleMedium,
                )
                Spacer(Modifier.height(2.dp))
                Text(
                    text = trackerSubtitle(enabled, lastFixAt, context),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (enabled && pendingCount > 0) {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        text = stringResource(R.string.tracking_card_pending, pendingCount),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.tertiary,
                    )
                }
            }
            Switch(
                checked = enabled,
                onCheckedChange = { wantOn ->
                    if (!wantOn) {
                        onToggle(false)
                        return@Switch
                    }
                    val granted = ContextCompat.checkSelfPermission(
                        context,
                        Manifest.permission.ACCESS_FINE_LOCATION,
                    ) == android.content.pm.PackageManager.PERMISSION_GRANTED
                    if (granted) {
                        onToggle(true)
                        if (!hasBackgroundPermission) {
                            showBackgroundRationale = true
                        }
                    } else {
                        foregroundLauncher.launch(
                            arrayOf(
                                Manifest.permission.ACCESS_FINE_LOCATION,
                                Manifest.permission.ACCESS_COARSE_LOCATION,
                            ),
                        )
                    }
                },
            )
        }
    }
}

@Composable
private fun trackerSubtitle(
    enabled: Boolean,
    lastFixAt: Long?,
    context: android.content.Context,
): String {
    if (!enabled) {
        return stringResource(R.string.tracking_card_subtitle_off)
    }
    if (lastFixAt == null) {
        return stringResource(R.string.tracking_card_subtitle_on_never)
    }
    val relative = DateUtils.getRelativeTimeSpanString(
        lastFixAt,
        System.currentTimeMillis(),
        DateUtils.MINUTE_IN_MILLIS,
        DateUtils.FORMAT_ABBREV_RELATIVE,
    ).toString()
    return context.getString(R.string.tracking_card_subtitle_on, relative)
}
