package com.threefat.vcts.ui.tracking

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.threefat.vcts.R

/**
 * One-shot dialog asking the user for `ACCESS_BACKGROUND_LOCATION`. The
 * Android UX guideline is to (a) explain *why* we need it before showing
 * the system prompt, and (b) on Android 11+ the system bumps the user
 * out to the system settings screen anyway, so we offer a direct
 * "Open settings" button as a fallback.
 *
 * Surface contract:
 *   - Caller decides when to show this (typically right after the agent
 *     toggles "active duty" on for the first time).
 *   - The launcher result is intentionally not propagated back to the
 *     caller - the dashboard reads
 *     [com.threefat.vcts.tracking.LocationLoggerScheduler.hasBackgroundLocation]
 *     on the next composition to update the banner.
 */
@Composable
fun BackgroundLocationRationaleDialog(
    visible: Boolean,
    onDismiss: () -> Unit,
) {
    if (!visible) return
    val context = LocalContext.current
    var requestedOnce by remember { mutableStateOf(false) }

    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission(),
    ) { _ ->
        // Whether granted or not, dismiss - the dashboard will re-check
        // permission state on the next composition. If denied with
        // "Don't ask again" the user can use Open settings.
        requestedOnce = true
        onDismiss()
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = stringResource(R.string.tracking_background_required),
                style = MaterialTheme.typography.titleLarge,
            )
        },
        text = {
            Column {
                Text(
                    text = stringResource(R.string.tracking_background_subtitle),
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(Modifier.height(12.dp))
            }
        },
        confirmButton = {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
            ) {
                if (requestedOnce) {
                    OutlinedButton(
                        onClick = {
                            openAppSettings(context as? Activity ?: return@OutlinedButton)
                            onDismiss()
                        },
                    ) {
                        Text(stringResource(R.string.tracking_background_open_settings))
                    }
                }
                Button(
                    onClick = {
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            launcher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                        } else {
                            // Pre-Q the foreground permission is enough.
                            onDismiss()
                        }
                    },
                ) {
                    Text(stringResource(R.string.tracking_background_request))
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(R.string.tracking_background_skip))
            }
        },
    )
}

private fun openAppSettings(activity: Activity) {
    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
        data = Uri.fromParts("package", activity.packageName, null)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    activity.startActivity(intent)
}
