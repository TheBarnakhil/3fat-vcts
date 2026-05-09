package com.threefat.vcts

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.hilt.navigation.compose.hiltViewModel
import com.threefat.vcts.ui.nav.AppNavHost
import com.threefat.vcts.ui.shell.AppShellViewModel
import com.threefat.vcts.ui.theme.VctsTheme
import dagger.hilt.android.AndroidEntryPoint

/**
 * Single activity. Compose owns every screen; this class only:
 *   1. Installs the splash screen (Android 12+ aware via androidx.core.splashscreen)
 *   2. Goes edge-to-edge so our Compose layouts handle insets explicitly
 *   3. Wraps the nav host in [VctsTheme] with the user's preferred mode
 *   4. On API 33+, re-prompts for [Manifest.permission.POST_NOTIFICATIONS] on
 *      every [onStart] until granted so foreground-service tracking and any
 *      future notification surfaces are never silently blocked.
 */
@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    private val requestPostNotifications =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            val shellVm: AppShellViewModel = hiltViewModel()
            val themeMode by shellVm.themeMode.collectAsState()
            VctsTheme(themeMode = themeMode) {
                AppNavHost()
            }
        }
    }

    override fun onStart() {
        super.onStart()
        requestNotificationPermissionIfNeeded()
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (!granted) {
            requestPostNotifications.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}
