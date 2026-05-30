package com.threefat.vcts.ui.collections

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.threefat.vcts.data.repository.CollectionsRepository
import com.threefat.vcts.data.repository.CustomersRepository
import com.threefat.vcts.domain.model.CollectionRecord
import com.threefat.vcts.sync.SyncScheduler
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class CollectionsListViewModel @Inject constructor(
    private val collectionsRepository: CollectionsRepository,
    private val customersRepository: CustomersRepository,
    private val syncScheduler: SyncScheduler,
) : ViewModel() {

    private val _state = MutableStateFlow(CollectionsListUiState())
    val state: StateFlow<CollectionsListUiState> = _state.asStateFlow()

    val rows: StateFlow<List<CollectionRow>> = combine(
        collectionsRepository.observeRecent(100),
        customersRepository.observeAll(),
    ) { collections, customers ->
        collections.map { record ->
            val customerName = customers.firstOrNull { it.id == record.customerId }?.name
                ?: record.customerId
            CollectionRow(record = record, customerName = customerName)
        }
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000L),
        initialValue = emptyList(),
    )

    init {
        refresh()
    }

    fun refresh() {
        viewModelScope.launch {
            _state.update { it.copy(isRefreshing = true) }
            syncScheduler.requestImmediate()
            delay(1_200L)
            _state.update { it.copy(isRefreshing = false) }
        }
    }
}

data class CollectionsListUiState(
    val isRefreshing: Boolean = false,
)

data class CollectionRow(
    val record: CollectionRecord,
    val customerName: String,
)
