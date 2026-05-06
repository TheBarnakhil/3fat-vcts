package com.threefat.vcts.ui.nav

/**
 * Strongly-typed navigation routes. We avoid hand-typed strings at call sites
 * so a typo in a `navigate()` call fails to compile rather than silently
 * doing nothing.
 *
 * Routes that take an argument expose a `with(...)` helper so the call site
 * stays declarative, and a constant for the registration site (`Customer`,
 * not `customer/{id}`).
 */
object Routes {
    const val Login = "login"
    const val Dashboard = "dashboard"
    const val Settings = "settings"
    const val Customers = "customers"
    const val OfflineQueue = "offline-queue"

    object Customer {
        const val ArgId = "id"
        const val Pattern = "customer/{$ArgId}"
        fun with(id: String) = "customer/$id"
    }

    object Collection {
        const val ArgCustomerId = "customerId"
        const val Pattern = "customer/{$ArgCustomerId}/collection"
        fun with(customerId: String) = "customer/$customerId/collection"
    }

    object Receipt {
        const val ArgId = "id"
        const val ArgReplayed = "replayed"
        const val Pattern = "receipt/{$ArgId}?replayed={$ArgReplayed}"
        fun with(id: String, replayed: Boolean = false) =
            "receipt/$id?replayed=$replayed"
    }
}
