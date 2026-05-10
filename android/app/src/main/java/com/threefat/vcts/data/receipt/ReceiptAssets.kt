package com.threefat.vcts.data.receipt

import android.graphics.Bitmap
import com.threefat.vcts.data.remote.dto.ReceiptAgentDto
import com.threefat.vcts.data.remote.dto.ReceiptTenantDto

/**
 * Phase 10 / Track C1.
 *
 * Pre-fetched bytes the renderer needs to draw a web-parity receipt
 * PDF. Everything is optional - missing slots fall back to "Not
 * captured" placeholders or omitted decoration. Holding the bytes in
 * memory is fine: at worst we have a 2 MB photo + a 100 KB signature
 * + a 30 KB map + a 5 KB QR + a 30 KB logo. That's a 2 MB peak per
 * render, well below the device budget.
 */
data class ReceiptEmbedAssets(
    val logo: ImageAsset? = null,
    val photo: ImageAsset? = null,
    val signature: ImageAsset? = null,
    val mapThumbnail: ImageAsset? = null,
    val qr: Bitmap? = null,
)

data class ImageAsset(
    val bytes: ByteArray,
    /** "image/jpeg" or "image/png". Anything else is treated as PNG. */
    val mime: String,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is ImageAsset) return false
        return mime == other.mime && bytes.contentEquals(other.bytes)
    }

    override fun hashCode(): Int = mime.hashCode() * 31 + bytes.contentHashCode()
}

/**
 * Branding + agent metadata used in the receipt header. When the
 * server doesn't return a `legalName` we fall back to the tenant's
 * display name; the device cannot use the slug here because the slug
 * is camel/lowercase and never user-facing.
 */
data class ReceiptHeaderInfo(
    val tenant: ReceiptTenantDto,
    val agent: ReceiptAgentDto,
)
