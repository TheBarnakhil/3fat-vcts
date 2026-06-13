package com.threefat.vcts.ui.nav

import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.IntOffset
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.threefat.vcts.ui.auth.LoginScreen
import java.net.URLDecoder
import com.threefat.vcts.ui.capture.PhotoCaptureScreen
import com.threefat.vcts.ui.capture.SignaturePadScreen
import com.threefat.vcts.ui.cms.IntegrationWebViewScreen
import com.threefat.vcts.ui.collection.CollectionFormScreen
import com.threefat.vcts.ui.collections.CollectionsListScreen
import com.threefat.vcts.ui.customers.CustomerDetailScreen
import com.threefat.vcts.ui.customers.CustomersListScreen
import com.threefat.vcts.ui.dashboard.DashboardScreen
import com.threefat.vcts.ui.queue.OfflineQueueScreen
import com.threefat.vcts.ui.receipt.ReceiptPreviewScreen
import com.threefat.vcts.ui.settings.SettingsScreen
import com.threefat.vcts.ui.shell.AppShellViewModel
import com.threefat.vcts.ui.theme.DurationStandard
import com.threefat.vcts.ui.theme.EaseInOutCubic

/**
 * App's nav graph. The starting destination is decided once - if a refresh
 * token is on disk we land directly on Dashboard; otherwise on Login.
 *
 * Slide+fade is applied to all transitions; durations honour the three-tier
 * cap from [com.threefat.vcts.ui.theme.Motion]. We deliberately use the same
 * spec for forward and back nav so the experience is symmetric.
 */
@Composable
fun AppNavHost(
    modifier: Modifier = Modifier,
    navController: NavHostController = rememberNavController(),
) {
    val shellVm: AppShellViewModel = hiltViewModel()
    val startDestination by shellVm.startDestination.collectAsState()

    val transition = tween<Float>(DurationStandard, easing = EaseInOutCubic)
    val intTransition = tween<IntOffset>(DurationStandard, easing = EaseInOutCubic)

    NavHost(
        navController = navController,
        startDestination = startDestination,
        modifier = modifier,
        enterTransition = {
            slideInHorizontally(animationSpec = intTransition) { it / 12 } +
                    fadeIn(animationSpec = transition)
        },
        exitTransition = { fadeOut(animationSpec = transition) },
        popEnterTransition = {
            slideInHorizontally(animationSpec = intTransition) { -it / 12 } +
                    fadeIn(animationSpec = transition)
        },
        popExitTransition = {
            slideOutHorizontally(animationSpec = intTransition) { it / 12 } +
                    fadeOut(animationSpec = transition)
        },
    ) {
        composable(Routes.Login) {
            LoginScreen(
                onLoggedIn = {
                    navController.navigate(Routes.Dashboard) {
                        popUpTo(Routes.Login) { inclusive = true }
                        launchSingleTop = true
                    }
                },
            )
        }

        composable(Routes.Dashboard) {
            DashboardScreen(
                onOpenSettings = { navController.navigate(Routes.Settings) },
                onOpenCustomers = { navController.navigate(Routes.Customers) },
                onOpenQueue = { navController.navigate(Routes.OfflineQueue) },
                onOpenCollections = { navController.navigate(Routes.Collections) },
            )
        }

        composable(Routes.Collections) {
            CollectionsListScreen(
                onBack = { navController.popBackStack() },
                onOpenReceipt = { id -> navController.navigate(Routes.Receipt.with(id, replayed = true)) },
            )
        }

        composable(Routes.OfflineQueue) {
            OfflineQueueScreen(
                onBack = { navController.popBackStack() },
            )
        }

        composable(Routes.Customers) {
            CustomersListScreen(
                onBack = { navController.popBackStack() },
                onOpenCustomer = { id ->
                    navController.navigate(Routes.Customer.with(id))
                },
            )
        }

        composable(
            route = Routes.Customer.Pattern,
            arguments = listOf(navArgument(Routes.Customer.ArgId) { type = NavType.StringType }),
        ) {
            CustomerDetailScreen(
                onBack = { navController.popBackStack() },
                onStartCollection = { customerId ->
                    navController.navigate(Routes.Collection.with(customerId))
                },
            )
        }

        composable(
            route = Routes.Collection.Pattern,
            arguments = listOf(
                navArgument(Routes.Collection.ArgCustomerId) { type = NavType.StringType },
            ),
        ) {
            CollectionFormScreen(
                onBack = { navController.popBackStack() },
                onSubmitted = { collectionId, replayed ->
                    navController.navigate(Routes.Receipt.with(collectionId, replayed)) {
                        // Pop the form off the back stack so the back
                        // arrow on the receipt screen returns to the
                        // customer detail, not the form we just left.
                        popUpTo(Routes.Collection.Pattern) { inclusive = true }
                    }
                },
                onOpenWebView = { url ->
                    navController.navigate(Routes.IntegrationWebView.with(url))
                },
            )
        }

        composable(
            route = Routes.IntegrationWebView.Pattern,
            arguments = listOf(
                navArgument(Routes.IntegrationWebView.ArgUrl) { type = NavType.StringType },
            ),
        ) { entry ->
            val encodedUrl = checkNotNull(entry.arguments?.getString(Routes.IntegrationWebView.ArgUrl))
            IntegrationWebViewScreen(
                url = URLDecoder.decode(encodedUrl, Charsets.UTF_8.name()),
                onBack = { navController.popBackStack() },
            )
        }

        composable(
            route = Routes.Receipt.Pattern,
            arguments = listOf(
                navArgument(Routes.Receipt.ArgId) { type = NavType.StringType },
                navArgument(Routes.Receipt.ArgReplayed) {
                    type = NavType.BoolType
                    defaultValue = false
                },
            ),
        ) {
            ReceiptPreviewScreen(
                onDone = {
                    // Done returns the agent to the customers list so
                    // the next collection is one tap away.
                    navController.navigate(Routes.Customers) {
                        popUpTo(Routes.Customers) { inclusive = true }
                        launchSingleTop = true
                    }
                },
                onCapturePhoto = { collectionId ->
                    navController.navigate(Routes.Capture.photo(collectionId))
                },
                onCaptureSignature = { collectionId ->
                    navController.navigate(Routes.Capture.signature(collectionId))
                },
            )
        }

        composable(
            route = Routes.Capture.PhotoPattern,
            arguments = listOf(
                navArgument(Routes.Capture.ArgCollectionId) { type = NavType.StringType },
            ),
        ) {
            PhotoCaptureScreen(
                onCancel = { navController.popBackStack() },
                onCaptured = { navController.popBackStack() },
            )
        }

        composable(
            route = Routes.Capture.SignaturePattern,
            arguments = listOf(
                navArgument(Routes.Capture.ArgCollectionId) { type = NavType.StringType },
            ),
        ) {
            SignaturePadScreen(
                onCancel = { navController.popBackStack() },
                onSaved = { navController.popBackStack() },
            )
        }

        composable(Routes.Settings) {
            SettingsScreen(
                onBack = { navController.popBackStack() },
                onSignedOut = {
                    navController.navigate(Routes.Login) {
                        popUpTo(0) { inclusive = true }
                        launchSingleTop = true
                    }
                },
            )
        }
    }
}
