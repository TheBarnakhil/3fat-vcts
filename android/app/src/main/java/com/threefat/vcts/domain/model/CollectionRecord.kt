package com.threefat.vcts.domain.model

import com.threefat.vcts.domain.sync.SyncStatus

/**
 * Domain model for a collection. Phase 6 made this dual-purpose: the same
 * type represents both server-acknowledged rows (the common case, where
 * [receiptNo] is non-null and [syncStatus] is SYNCED) and optimistic rows
 * the device created offline (receiptNo null until the server replies,
 * syncStatus is one of PENDING / IN_FLIGHT / FAILED).
 *
 * The receipt preview screen renders both; callers gate the share/print
 * actions on `syncStatus == SYNCED && receiptNo != null`.
 */
data class CollectionRecord(
    val id: String,
    val clientUuid: String?,
    val customerId: String,
    val agentId: String,
    /** Null for optimistic rows that haven't been confirmed by the server. */
    val receiptNo: String?,
    val amount: Double,
    val paymentMode: PaymentMode,
    val refNo: String?,
    val chequeDate: String?,
    val remarks: String?,
    val collectionLat: Double,
    val collectionLng: Double,
    val gpsAccuracyM: Double?,
    val collectedAtIso: String,
    val supervisorReview: Boolean,
    val syncStatus: SyncStatus = SyncStatus.SYNCED,
    /**
     * Phase 8 - R2 keys (NOT URLs) for the optional photo + signature
     * attachments. Both null means "not captured"; the receipt UI shows
     * a "Not captured" placeholder for either side.
     */
    val photoUrl: String? = null,
    val signatureUrl: String? = null,
    /**
     * Phase 8 - on-device file paths for not-yet-uploaded attachments.
     * The drainer clears these once the bytes land in R2.
     */
    val photoLocalPath: String? = null,
    val signatureLocalPath: String? = null,
) {
    val isPending: Boolean get() = syncStatus != SyncStatus.SYNCED
    val hasPendingAttachmentUpload: Boolean
        get() = photoLocalPath != null || signatureLocalPath != null
    val hasAnyAttachment: Boolean
        get() =
            photoUrl != null || signatureUrl != null ||
                photoLocalPath != null || signatureLocalPath != null
}

enum class PaymentMode(val wireValue: String, val display: String) {
    Cash("cash", "Cash"),
    Cheque("cheque", "Cheque"),
    BankTransfer("bank_transfer", "Bank transfer"),
    Upi("upi", "UPI");

    companion object {
        fun fromWire(value: String): PaymentMode? =
            entries.firstOrNull { it.wireValue == value }

        fun requiresReference(mode: PaymentMode): Boolean = when (mode) {
            Cash -> false
            Cheque, BankTransfer, Upi -> true
        }
    }
}
