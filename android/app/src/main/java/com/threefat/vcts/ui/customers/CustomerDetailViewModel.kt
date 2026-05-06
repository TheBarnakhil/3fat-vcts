package com.threefat.vcts.ui.customers

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.threefat.vcts.data.location.LocationFix
import com.threefat.vcts.data.location.LocationProvider
import com.threefat.vcts.data.repository.CustomersRepository
import com.threefat.vcts.domain.geo.GeofenceStatus
import com.threefat.vcts.domain.geo.geofenceStatus
import com.threefat.vcts.domain.model.Customer
import com.threefat.vcts.ui.nav.Routes
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class CustomerDetailViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val customersRepository: CustomersRepository,
    private val locationProvider: LocationProvider,
) : ViewModel() {

    val customerId: String = checkNotNull(savedStateHandle[Routes.Customer.ArgId])

    val state: StateFlow<CustomerDetailUiState> = combine(
        customersRepository.observe(customerId),
        currentLocation(),
    ) { customer, fix ->
        CustomerDetailUiState(
            customer = customer,
            fix = fix,
            geofence = if (customer != null && fix != null) {
                geofenceStatus(
                    agentLat = fix.lat,
                    agentLng = fix.lng,
                    accuracyM = fix.accuracyM,
                    customerLat = customer.lat,
                    customerLng = customer.lng,
                    allowedM = customer.geofenceRadiusM,
                )
            } else {
                null
            },
        )
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000L),
        initialValue = CustomerDetailUiState(),
    )

    init {
        // Best-effort one-shot refresh so the radius / coordinates the
        // agent is about to walk to are current. Errors are swallowed -
        // the local cache is sufficient and the network might be flaky.
        viewModelScope.launch {
            customersRepository.refreshOne(customerId)
        }
    }

    private fun currentLocation(): Flow<LocationFix?> {
        if (!locationProvider.hasFineLocationPermission()) return flowOf(null)
        val source = locationProvider.observe(intervalMs = 2_000L)
        return flow {
            emit(null)
            emitAll(source)
        }
    }
}

data class CustomerDetailUiState(
    val customer: Customer? = null,
    val fix: LocationFix? = null,
    val geofence: GeofenceStatus? = null,
)
