package com.threefat.vcts.ui.shell

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.threefat.vcts.data.preferences.AppPreferences
import com.threefat.vcts.data.session.SessionStore
import com.threefat.vcts.domain.model.ThemeMode
import com.threefat.vcts.sync.SyncScheduler
import com.threefat.vcts.ui.nav.Routes
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

/**
 * Resolves cold-start state for the navigation host:
 *   - [startDestination]: Login if there's no refresh token, Dashboard otherwise.
 *   - [themeMode]: streams the user's persisted preference; defaults to System.
 *
 * The start destination is resolved synchronously via [SessionStore]'s in-
 * memory snapshot of the Keystore-backed value, so the nav host never flashes
 * Login then bounces to Dashboard on launch.
 */
@HiltViewModel
class AppShellViewModel @Inject constructor(
    sessionStore: SessionStore,
    appPreferences: AppPreferences,
    syncScheduler: SyncScheduler,
) : ViewModel() {

    private val initialStart = if (sessionStore.persistedRefreshToken.isNullOrBlank()) {
        Routes.Login
    } else {
        Routes.Dashboard
    }

    private val _startDestination = MutableStateFlow(initialStart)
    val startDestination: StateFlow<String> = _startDestination.asStateFlow()

    val themeMode: StateFlow<ThemeMode> = appPreferences.themeMode
        .stateIn(viewModelScope, SharingStarted.Eagerly, ThemeMode.System)

    init {
        if (!sessionStore.persistedRefreshToken.isNullOrBlank()) {
            syncScheduler.requestImmediate()
        }
    }
}
