package com.threefat.vcts.ui.theme

import android.app.Activity
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import com.threefat.vcts.domain.model.ThemeMode

/**
 * Light scheme - airy whites with the brand blue as primary; surfaces are
 * slightly off-white so the eye finds containers without aggressive shadows.
 */
private val LightColors = lightColorScheme(
    primary = BrandPalette.Primary600,
    onPrimary = BrandPalette.White,
    primaryContainer = BrandPalette.Primary100,
    onPrimaryContainer = BrandPalette.Slate900,
    secondary = BrandPalette.Slate700,
    onSecondary = BrandPalette.White,
    background = BrandPalette.Slate50,
    onBackground = BrandPalette.Slate900,
    surface = BrandPalette.White,
    onSurface = BrandPalette.Slate900,
    surfaceVariant = BrandPalette.Slate100,
    onSurfaceVariant = BrandPalette.Slate700,
    outline = BrandPalette.Slate300,
    outlineVariant = BrandPalette.Slate100,
    error = BrandPalette.Danger,
    onError = BrandPalette.White,
)

/**
 * Dark scheme - tuned for OLED panels in field use. Background is near-black
 * so the agent's screen doesn't blast bystanders at night, but surfaces lift
 * one step at a time so cards remain readable.
 */
private val DarkColors = darkColorScheme(
    primary = BrandPalette.Primary500,
    onPrimary = BrandPalette.Slate950,
    primaryContainer = BrandPalette.Primary600,
    onPrimaryContainer = BrandPalette.White,
    secondary = BrandPalette.Slate300,
    onSecondary = BrandPalette.Slate950,
    background = BrandPalette.Slate950,
    onBackground = BrandPalette.Slate100,
    surface = BrandPalette.Slate900,
    onSurface = BrandPalette.Slate100,
    surfaceVariant = BrandPalette.Slate800,
    onSurfaceVariant = BrandPalette.Slate300,
    outline = BrandPalette.Slate700,
    outlineVariant = BrandPalette.Slate800,
    error = BrandPalette.Danger,
    onError = BrandPalette.White,
)

/**
 * Top-level theme wrapper. Every screen must be wrapped in this composable.
 *
 * @param themeMode resolves to system / light / dark; defaults to system so
 *  the very first frame after install matches the OS preference.
 * @param dynamicColor opt-in tenant setting (Android 12+). Default off so
 *  brand stays consistent across devices, matching the plan.
 */
@Composable
fun VctsTheme(
    themeMode: ThemeMode = ThemeMode.System,
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit,
) {
    val systemDark = isSystemInDarkTheme()
    val useDark = when (themeMode) {
        ThemeMode.System -> systemDark
        ThemeMode.Light -> false
        ThemeMode.Dark -> true
    }

    val context = LocalContext.current
    val colors = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (useDark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        useDark -> DarkColors
        else -> LightColors
    }

    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            // System bar tinting: contrast must be readable against the
            // background colour. We let the platform draw icons in the right
            // tone via the appearance flags.
            val window = (view.context as Activity).window
            window.statusBarColor = colors.background.toArgb()
            window.navigationBarColor = colors.background.toArgb()
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !useDark
                isAppearanceLightNavigationBars = !useDark
            }
        }
    }

    MaterialTheme(
        colorScheme = colors,
        typography = VctsTypography,
        shapes = VctsShapes,
        content = content,
    )
}
