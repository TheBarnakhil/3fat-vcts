package com.threefat.vcts.domain.model

/**
 * User-selectable theme. Persisted as a stable string ID in DataStore so the
 * value survives codebase refactors that reorder enum constants.
 */
enum class ThemeMode(val storageKey: String) {
    System("system"),
    Light("light"),
    Dark("dark");

    companion object {
        fun fromKey(key: String?): ThemeMode = entries.firstOrNull { it.storageKey == key } ?: System
    }
}
