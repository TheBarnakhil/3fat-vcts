package com.threefat.vcts.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.Easing

/**
 * Three-tier motion vocabulary, matching the web side's GSAP setup.
 *
 * - [DurationMicro] (120ms): button presses, ripples, toggles
 * - [DurationStandard] (240ms): list reorders, card lifts, dialog scales
 * - [DurationEmphasized] (400ms): screen entrances, shared-element transitions
 *
 * Anything longer should be questioned in code review. We never run an
 * indefinite animation outside of a loading shimmer.
 */
internal const val DurationMicro = 120
internal const val DurationStandard = 240
internal const val DurationEmphasized = 400

/** `power2.out` equivalent - decelerating; entrances use this. */
internal val EaseOutCubic: Easing = CubicBezierEasing(0.33f, 1f, 0.68f, 1f)

/** `power2.inOut` equivalent - balanced; transitions and content swaps use this. */
internal val EaseInOutCubic: Easing = CubicBezierEasing(0.65f, 0f, 0.35f, 1f)

/** Sharper accent for button taps; doesn't overshoot. */
internal val EaseEmphasized: Easing = CubicBezierEasing(0.2f, 0f, 0f, 1f)
