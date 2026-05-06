package com.threefat.vcts.ui.motion

import android.content.Context
import android.provider.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect

/**
 * Honors the OS-level "Remove animations" setting (Android 11+). When the
 * user has disabled animations, our motion primitives fall back to instant
 * visibility - we never override the system preference.
 */
fun isAccessibilityReduceMotion(context: Context): Boolean {
    return try {
        val scale = Settings.Global.getFloat(
            context.contentResolver,
            Settings.Global.ANIMATOR_DURATION_SCALE,
            1f,
        )
        scale == 0f
    } catch (_: Throwable) {
        false
    }
}

/** Runs [block] exactly once for the lifetime of the enclosing composable. */
@Composable
internal fun LaunchOnce(block: suspend () -> Unit) {
    LaunchedEffect(Unit) { block() }
}
