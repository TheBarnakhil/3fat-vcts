package com.threefat.vcts.ui.theme

import androidx.compose.ui.graphics.Color

/**
 * Brand-locked colour tokens. These are the only place a hex literal lives in
 * the UI layer; everything else references either [LightColors] or
 * [DarkColors] in [Theme.kt].
 *
 * The values are tuned to match the web side's tokens in
 * `web/src/app/globals.css` so the brand reads consistently across surfaces.
 * Dark-mode surfaces lean OLED-friendly (near-black) so the Phase 5 collection
 * form is comfortable in low-light field conditions.
 */
internal object BrandPalette {
    // Primary - the web's `--primary` token (HSL 217 91% 60%) translated to hex.
    val Primary500 = Color(0xFF3B82F6)
    val Primary600 = Color(0xFF2563EB)
    val Primary100 = Color(0xFFDBEAFE)

    // Neutrals
    val Slate950 = Color(0xFF0B1020)
    val Slate900 = Color(0xFF0F172A)
    val Slate800 = Color(0xFF1E293B)
    val Slate700 = Color(0xFF334155)
    val Slate500 = Color(0xFF64748B)
    val Slate300 = Color(0xFFCBD5E1)
    val Slate100 = Color(0xFFF1F5F9)
    val Slate50  = Color(0xFFF8FAFC)
    val White    = Color(0xFFFFFFFF)

    // Semantic
    val Success  = Color(0xFF10B981)
    val Warning  = Color(0xFFF59E0B)
    val Danger   = Color(0xFFEF4444)
}
