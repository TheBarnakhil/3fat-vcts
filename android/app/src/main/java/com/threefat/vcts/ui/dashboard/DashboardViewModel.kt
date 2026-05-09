package com.threefat.vcts.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.threefat.vcts.data.preferences.AppPreferences
import com.threefat.vcts.data.session.SessionStore
import com.threefat.vcts.data.sync.SyncRepository
import com.threefat.vcts.domain.model.SessionPublicInfo
import com.threefat.vcts.domain.model.publicInfo
import com.threefat.vcts.tracking.LocationLoggerScheduler
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

@HiltViewModel
class DashboardViewModel @Inject constructor(
    sessionStore: SessionStore,
    syncRepository: SyncRepository,
    private val appPreferences: AppPreferences,
    private val trackerScheduler: LocationLoggerScheduler,
) : ViewModel() {

    val info: StateFlow<SessionPublicInfo?> = sessionStore.session
        .map { it?.publicInfo() }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    /** Live pending+failed count for the queue badge on the dashboard. */
    val pendingCount: StateFlow<Int> = syncRepository.observePendingCount()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)

    /** Phase 7: tracker UI state. */
    val trackingEnabled: StateFlow<Boolean> = appPreferences.trackingEnabled
        .stateIn(viewModelScope, SharingStarted.Eagerly, false)

    val trackingLastFixAt: StateFlow<Long?> = appPreferences.trackingLastFixAt
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), null)

    val pendingLocationLogCount: StateFlow<Int> =
        syncRepository.observePendingLocationLogCount()
            .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)

    /**
     * Toggle the active-duty tracker. Caller is expected to have ensured
     * fine-location is granted before flipping this on; the scheduler
     * itself is defensive (no-op if permission is missing) but the UI
     * layer is the right place to surface the system permission prompt.
     */
    fun setTrackingEnabled(enabled: Boolean) {
        viewModelScope.launch {
            if (enabled) trackerScheduler.enable()
            else trackerScheduler.disable()
        }
    }

    fun hasBackgroundLocation(): Boolean = trackerScheduler.hasBackgroundLocation()
}
