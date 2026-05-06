package com.threefat.vcts.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.threefat.vcts.data.preferences.AppPreferences
import com.threefat.vcts.data.repository.AuthRepository
import com.threefat.vcts.data.session.SessionStore
import com.threefat.vcts.domain.model.SessionPublicInfo
import com.threefat.vcts.domain.model.ThemeMode
import com.threefat.vcts.domain.model.publicInfo
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val appPreferences: AppPreferences,
    private val authRepository: AuthRepository,
    sessionStore: SessionStore,
) : ViewModel() {

    val themeMode: StateFlow<ThemeMode> = appPreferences.themeMode
        .stateIn(viewModelScope, SharingStarted.Eagerly, ThemeMode.System)

    val info: StateFlow<SessionPublicInfo?> = sessionStore.session
        .map { it?.publicInfo() }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val _signedOut = MutableStateFlow(false)
    val signedOut: StateFlow<Boolean> = _signedOut.asStateFlow()

    fun setThemeMode(mode: ThemeMode) {
        viewModelScope.launch { appPreferences.setThemeMode(mode) }
    }

    fun signOut() {
        viewModelScope.launch {
            authRepository.logout()
            _signedOut.value = true
        }
    }
}
