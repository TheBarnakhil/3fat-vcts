package com.threefat.vcts.ui.motion

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.LinearOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.ElevatedCard
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.threefat.vcts.ui.theme.DurationEmphasized
import com.threefat.vcts.ui.theme.DurationStandard
import com.threefat.vcts.ui.theme.EaseOutCubic

/**
 * Card that does a one-shot fade-and-rise on first composition, mirroring the
 * web's `fadeRise` GSAP preset. Idempotent within a single recomposition tree
 * - if the parent restarts the animation, we play once and stay put.
 */
@Composable
fun AnimatedCard(
    modifier: Modifier = Modifier,
    delayMillis: Int = 0,
    content: @Composable () -> Unit,
) {
    var visible by remember { mutableStateOf(false) }
    val context = LocalContext.current
    val reduceMotion = remember { isAccessibilityReduceMotion(context) }

    LaunchOnce {
        visible = true
    }

    if (reduceMotion) {
        ElevatedCard(modifier = modifier) { content() }
        return
    }

    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(
            animationSpec = tween(DurationStandard, delayMillis = delayMillis, easing = EaseOutCubic)
        ) + slideInVertically(
            animationSpec = tween(DurationStandard, delayMillis = delayMillis, easing = EaseOutCubic),
            initialOffsetY = { it / 6 },
        ),
        exit = fadeOut(animationSpec = tween(DurationStandard)) +
                slideOutVertically(animationSpec = tween(DurationStandard)),
    ) {
        ElevatedCard(modifier = modifier) { content() }
    }
}

/**
 * Lazy list with per-item entrance delays - first item lands at 0ms, each
 * subsequent item delayed by [staggerMillis]. Capped at 6 visible-stagger
 * slots so a 100-row list doesn't take 4 seconds to play in.
 */
@Composable
fun StaggeredList(
    modifier: Modifier = Modifier,
    staggerMillis: Int = 60,
    maxStaggers: Int = 6,
    content: LazyListScope.(staggerDelayFor: (Int) -> Int) -> Unit,
) {
    val delayFor: (Int) -> Int = { idx ->
        (idx.coerceAtMost(maxStaggers)) * staggerMillis
    }
    LazyColumn(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(12.dp),
        contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
    ) {
        content(delayFor)
    }
}

/**
 * Convenience for a stagger over a known list. Each row enters via
 * [AnimatedCard] with the right delay applied.
 */
@Composable
fun <T> StaggeredColumn(
    items: List<T>,
    modifier: Modifier = Modifier,
    staggerMillis: Int = 60,
    itemContent: @Composable (Int, T) -> Unit,
) {
    Column(
        modifier = modifier.padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items.forEachIndexed { index, item ->
            AnimatedCard(delayMillis = (index.coerceAtMost(6)) * staggerMillis) {
                itemContent(index, item)
            }
        }
    }
}

/**
 * Helper for shared-bounds containers (Compose 1.7+ shared-transition API).
 * Phase 4 just declares the surface; the navigation graph in [AppNavHost]
 * passes the [SharedTransitionScope] through. We expose a thin wrapper so
 * downstream screens don't import shared-transition APIs directly.
 *
 * The actual shared-bounds modifier is added by callers that hold both ends
 * of the transition pair; the duration is hard-capped at [DurationEmphasized].
 */
@Suppress("unused")
internal const val SharedBoundsDurationMillis = DurationEmphasized
internal val SharedBoundsEasing = LinearOutSlowInEasing

/** Internal marker so all transitions share the same animation contract. */
internal val EmphasizedTween = tween<Float>(DurationEmphasized, easing = EaseOutCubic)
