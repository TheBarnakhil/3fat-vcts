package com.threefat.vcts.ui.customers

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.threefat.vcts.data.location.LocationFix
import com.threefat.vcts.data.location.LocationProvider
import com.threefat.vcts.data.repository.CustomersRepository
import com.threefat.vcts.domain.geo.haversineMeters
import com.threefat.vcts.domain.model.Customer
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Drives the customers list screen.
 *
 *  - Reads the local Room cache as the source of truth.
 *  - Fires a network refresh on first attach (and on pull-to-refresh).
 *  - Observes the agent's GPS so each row can show "X m away".
 *  - Filters by a search string (name or code, case-insensitive).
 */
@HiltViewModel
class CustomersListViewModel @Inject constructor(
    private val repository: CustomersRepository,
    private val locationProvider: LocationProvider,
) : ViewModel() {

    private val query = MutableStateFlow("")
    val searchQuery: StateFlow<String> = query.asStateFlow()

    private val _state = MutableStateFlow(CustomersListUiState())
    val state: StateFlow<CustomersListUiState> = _state.asStateFlow()

    /** Live customer rows joined with the latest GPS distance. */
    val rows: StateFlow<List<CustomerRow>> = combine(
        repository.observeAll(),
        query,
        currentLocation(),
    ) { customers, q, fix ->
        val term = q.trim().lowercase()
        val filtered = if (term.isEmpty()) customers else customers.filter {
            it.name.lowercase().contains(term) ||
                (it.code?.lowercase()?.contains(term) == true)
        }
        filtered.map { customer ->
            CustomerRow(
                customer = customer,
                distanceM = fix?.let { f ->
                    haversineMeters(f.lat, f.lng, customer.lat, customer.lng)
                },
            )
        }.sortedWith(
            compareBy(nullsLast()) { it.distanceM ?: Double.MAX_VALUE },
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000L),
        initialValue = emptyList(),
    )

    init {
        refresh()
    }

    fun setQuery(value: String) {
        query.value = value
    }

    fun refresh() {
        viewModelScope.launch {
            _state.update { it.copy(isRefreshing = true, error = null) }
            val result = repository.refresh()
            _state.update {
                it.copy(
                    isRefreshing = false,
                    error = if (result.isFailure) UiError.RefreshFailed else null,
                )
            }
        }
    }

    /**
     * Permission-gated location feed. Emits null first so the list shows
     * up immediately even before GPS produces a fix. When permission is
     * missing we stay on null forever and the rows simply omit the
     * distance suffix; the detail screen's permission gate handles the
     * rationale.
     */
    private fun currentLocation(): Flow<LocationFix?> {
        if (!locationProvider.hasFineLocationPermission()) return flowOf(null)
        val source = locationProvider.observe(intervalMs = 5_000L)
        return flow {
            emit(null)
            emitAll(source)
        }
    }
}

data class CustomersListUiState(
    val isRefreshing: Boolean = false,
    val error: UiError? = null,
)

enum class UiError { RefreshFailed }

data class CustomerRow(
    val customer: Customer,
    val distanceM: Double?,
)
