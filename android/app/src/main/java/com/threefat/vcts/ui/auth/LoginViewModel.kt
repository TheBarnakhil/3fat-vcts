package com.threefat.vcts.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.threefat.vcts.data.preferences.AppPreferences
import com.threefat.vcts.data.repository.AuthRepository
import com.threefat.vcts.data.repository.LoginFailure
import com.threefat.vcts.data.repository.LoginOutcome
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class LoginUiState(
    val email: String = "",
    val password: String = "",
    val isSubmitting: Boolean = false,
    val errorRes: LoginErrorReason? = null,
    val loaded: Boolean = false,
)

enum class LoginErrorReason { Network, InvalidCredentials, Server, Unknown }

@HiltViewModel
class LoginViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    private val appPreferences: AppPreferences,
) : ViewModel() {

    private val _state = MutableStateFlow(LoginUiState())
    val state: StateFlow<LoginUiState> = _state.asStateFlow()

    private val _events = MutableStateFlow<LoginEvent?>(null)
    val events: StateFlow<LoginEvent?> = _events.asStateFlow()

    init {
        viewModelScope.launch {
            val lastEmail = appPreferences.lastEmail.firstOrNull()
            _state.update { it.copy(email = lastEmail.orEmpty(), loaded = true) }
        }
    }

    fun onEmailChange(value: String) {
        _state.update { it.copy(email = value, errorRes = null) }
    }

    fun onPasswordChange(value: String) {
        _state.update { it.copy(password = value, errorRes = null) }
    }

    fun onSubmit() {
        val current = _state.value
        if (current.isSubmitting) return
        if (current.email.isBlank() || current.password.isBlank()) {
            _state.update { it.copy(errorRes = LoginErrorReason.InvalidCredentials) }
            return
        }
        _state.update { it.copy(isSubmitting = true, errorRes = null) }
        viewModelScope.launch {
            when (val outcome = authRepository.login(current.email, current.password)) {
                is LoginOutcome.Success -> {
                    _events.value = LoginEvent.NavigateHome
                    _state.update { it.copy(isSubmitting = false) }
                }
                is LoginOutcome.Failure -> {
                    _state.update {
                        it.copy(
                            isSubmitting = false,
                            errorRes = outcome.reason.toUiReason(),
                        )
                    }
                }
            }
        }
    }

    fun consumeEvent() {
        _events.value = null
    }
}

sealed interface LoginEvent {
    data object NavigateHome : LoginEvent
}

private fun LoginFailure.toUiReason(): LoginErrorReason = when (this) {
    LoginFailure.Network -> LoginErrorReason.Network
    LoginFailure.InvalidCredentials -> LoginErrorReason.InvalidCredentials
    LoginFailure.Server -> LoginErrorReason.Server
    LoginFailure.Unknown -> LoginErrorReason.Unknown
}
