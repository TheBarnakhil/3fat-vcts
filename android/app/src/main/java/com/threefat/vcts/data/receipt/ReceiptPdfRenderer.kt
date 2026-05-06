package com.threefat.vcts.data.receipt

import android.content.Context
import com.threefat.vcts.domain.model.CollectionRecord
import com.threefat.vcts.domain.model.Customer
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.font.PDType1Font
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.File
import java.text.NumberFormat
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 5 PDF generator. Lays out a minimal A5 receipt with the standard
 * fields agents will see in the field. Phase 8 will replace this with a
 * branded PDF that embeds the photo + signature + Static Map thumbnail
 * and uploads it to R2 via a presigned URL; until then we render
 * locally and surface a "Share" action so the receipt can be sent to
 * the customer via WhatsApp / SMS.
 *
 * Rendered files land in `cacheDir/receipts/{collectionId}.pdf`. Cache
 * files are subject to OS reclamation, which is the right level of
 * durability for a derivable artifact.
 *
 * Tip on layout: PdfBox's coordinate system has the origin at the
 * BOTTOM-left, not the top-left. Y increases upwards. We compute the
 * page top once and decrement as we go.
 */
@Singleton
class ReceiptPdfRenderer @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    suspend fun render(
        collection: CollectionRecord,
        customer: Customer?,
        tenantSlug: String,
    ): Result<File> = runCatching {
        // Pending rows have no receipt number yet - rendering would
        // produce a misleading PDF. Surface a typed failure instead so
        // the caller can show a "preparing receipt" state and re-render
        // once the queue drains.
        val receiptNo = collection.receiptNo
            ?: error("Cannot render receipt before sync (receiptNo is null)")
        withContext(Dispatchers.IO) {
            val dir = File(context.cacheDir, "receipts").apply { mkdirs() }
            val file = File(dir, "${collection.id}.pdf")

            PDDocument().use { doc ->
                val page = PDPage(PDRectangle.A5)
                doc.addPage(page)

                PDPageContentStream(doc, page).use { stream ->
                    val pageHeight = page.mediaBox.height
                    val left = 36f
                    var y = pageHeight - 48f

                    // Title
                    stream.beginText()
                    stream.setFont(PDType1Font.HELVETICA_BOLD, 20f)
                    stream.newLineAtOffset(left, y)
                    stream.showText("VCTS Receipt")
                    stream.endText()

                    y -= 28f
                    stream.beginText()
                    stream.setFont(PDType1Font.HELVETICA, 10f)
                    stream.newLineAtOffset(left, y)
                    stream.showText("Tenant: $tenantSlug")
                    stream.endText()

                    y -= 14f
                    stream.beginText()
                    stream.setFont(PDType1Font.COURIER, 12f)
                    stream.newLineAtOffset(left, y)
                    stream.showText("Receipt: $receiptNo")
                    stream.endText()

                    // Divider
                    y -= 14f
                    stream.moveTo(left, y)
                    stream.lineTo(page.mediaBox.width - left, y)
                    stream.stroke()

                    fun row(label: String, value: String, mono: Boolean = false) {
                        y -= 18f
                        stream.beginText()
                        stream.setFont(PDType1Font.HELVETICA_BOLD, 10f)
                        stream.newLineAtOffset(left, y)
                        stream.showText(label)
                        stream.endText()

                        stream.beginText()
                        stream.setFont(
                            if (mono) PDType1Font.COURIER else PDType1Font.HELVETICA,
                            11f,
                        )
                        stream.newLineAtOffset(left + 110f, y)
                        stream.showText(value)
                        stream.endText()
                    }

                    row("Customer", customer?.name ?: collection.customerId)
                    customer?.code?.let { row("Code", it, mono = true) }
                    row("Amount", formatRupees(collection.amount), mono = true)
                    row("Mode", collection.paymentMode.display)
                    collection.refNo?.let { row("Reference", it, mono = true) }
                    collection.chequeDate?.let { row("Cheque date", it, mono = true) }
                    row("Date", collection.collectedAtIso)
                    row(
                        "GPS",
                        "%.5f, %.5f".format(
                            collection.collectionLat,
                            collection.collectionLng,
                        ),
                        mono = true,
                    )
                    collection.gpsAccuracyM?.let {
                        row("GPS accuracy", "${it.toInt()} m", mono = true)
                    }
                    collection.remarks?.takeIf { it.isNotBlank() }?.let {
                        row("Remarks", it.take(80))
                    }

                    // Footer
                    y -= 36f
                    stream.beginText()
                    stream.setFont(PDType1Font.HELVETICA_OBLIQUE, 8f)
                    stream.newLineAtOffset(left, y)
                    stream.showText("Generated on device. Verify online via /r/$tenantSlug/$receiptNo")
                    stream.endText()
                }

                doc.save(file)
            }
            file
        }
    }

    private fun formatRupees(amount: Double): String {
        val nf = NumberFormat.getInstance(Locale.US)
        nf.minimumFractionDigits = 2
        nf.maximumFractionDigits = 2
        return "INR " + nf.format(amount)
    }
}
