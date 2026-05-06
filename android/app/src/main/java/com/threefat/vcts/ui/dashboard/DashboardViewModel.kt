package com.threefat.vcts.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.threefat.vcts.data.session.SessionStore
import com.threefat.vcts.data.sync.SyncRepository
import com.threefat.vcts.domain.model.SessionPublicInfo
import com.threefat.vcts.domain.model.publicInfo
import dagger.hilt.android.lifecycle.HiltViewModel
import javax.inject.Inject
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

@HiltViewModel
class DashboardViewModel @Inject constructor(
    sessionStore: SessionStore,
    syncRepository: SyncRepository,
) : ViewModel() {

    val info: StateFlow<SessionPublicInfo?> = sessionStore.session
        .map { it?.publicInfo() }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    /** Live pending+failed count for the queue badge on the dashboard. */
    val pendingCount: StateFlow<Int> = syncRepository.observePendingCount()
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), 0)
}
