package com.threefat.vcts.data.receipt

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import com.threefat.vcts.data.remote.dto.ReceiptAgentDto
import com.threefat.vcts.data.remote.dto.ReceiptTenantDto
import com.threefat.vcts.domain.model.CollectionRecord
import com.threefat.vcts.domain.model.Customer
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPage
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.common.PDRectangle
import com.tom_roush.pdfbox.pdmodel.font.PDFont
import com.tom_roush.pdfbox.pdmodel.font.PDType1Font
import com.tom_roush.pdfbox.pdmodel.graphics.image.JPEGFactory
import com.tom_roush.pdfbox.pdmodel.graphics.image.LosslessFactory
import com.tom_roush.pdfbox.pdmodel.graphics.image.PDImageXObject
import com.tom_roush.pdfbox.util.Matrix
import dagger.hilt.android.qualifiers.ApplicationContext
import java.io.ByteArrayInputStream
import java.io.File
import java.text.DateFormatSymbols
import java.text.NumberFormat
import java.text.ParseException
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Phase 10 / Track C1 - on-device PDF renderer with web-template parity.
 *
 * Mirrors `web/src/lib/receipts/pdf.ts`: A4 portrait with an accent
 * header band (logo + tenant block + receipt no + date), a two-column
 * "Received from / Collected by" block, an amount band, GPS / cheque
 * date / remarks meta rows, a three-slot attachments band (photo +
 * signature + GPS-pin map thumbnail), a verify-link QR code, and a
 * footer rule + disclaimer. Missing attachments fall back to "Not
 * captured" placeholders so the spatial layout stays consistent.
 *
 * The renderer is pure layout - all binary inputs (logo / photo /
 * signature / map thumbnail / QR bitmap) come from
 * [ReceiptAssetsLoader] and are passed in via [ReceiptEmbedAssets].
 *
 * Coordinate system note: PDFBox uses a bottom-left origin with Y
 * increasing upwards. We keep the running `y` cursor at the
 * "currently being drawn" line and decrement as we move down.
 */
@Singleton
class ReceiptPdfRenderer @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    suspend fun render(
        collection: CollectionRecord,
        customer: Customer?,
        tenantSlug: String,
        header: ReceiptHeaderInfo? = null,
        embeds: ReceiptEmbedAssets = ReceiptEmbedAssets(),
        verifyUrl: String? = null,
        reversed: Boolean = false,
    ): Result<File> = runCatching {
        val receiptNo = collection.receiptNo
            ?: error("Cannot render receipt before sync (receiptNo is null)")

        withContext(Dispatchers.IO) {
            val dir = File(context.cacheDir, "receipts").apply { mkdirs() }
            val file = File(dir, "${collection.id}.pdf")

            PDDocument().use { doc ->
                val page = PDPage(PDRectangle.A4)
                doc.addPage(page)

                val regular = PDType1Font.HELVETICA
                val bold = PDType1Font.HELVETICA_BOLD
                val mono = PDType1Font.COURIER

                val tenantInfo = header?.tenant ?: defaultTenant(tenantSlug)
                val agentInfo = header?.agent ?: ReceiptAgentDto()

                PDPageContentStream(doc, page).use { stream ->
                    drawDocument(
                        doc = doc,
                        stream = stream,
                        regular = regular,
                        bold = bold,
                        mono = mono,
                        tenant = tenantInfo,
                        agent = agentInfo,
                        collection = collection,
                        customer = customer,
                        receiptNo = receiptNo,
                        embeds = embeds,
                        verifyUrl = verifyUrl,
                        reversed = reversed,
                        tenantSlug = tenantSlug,
                    )
                }

                doc.save(file)
            }
            file
        }
    }

    private fun drawDocument(
        doc: PDDocument,
        stream: PDPageContentStream,
        regular: PDFont,
        bold: PDFont,
        mono: PDFont,
        tenant: ReceiptTenantDto,
        agent: ReceiptAgentDto,
        collection: CollectionRecord,
        customer: Customer?,
        receiptNo: String,
        embeds: ReceiptEmbedAssets,
        verifyUrl: String?,
        reversed: Boolean,
        tenantSlug: String,
    ) {
        var y = PAGE_HEIGHT - MARGIN

        // -- Header band -------------------------------------------------
        // Accent line at the top of the page.
        drawRect(
            stream,
            x = 0f,
            y = y - 6f,
            w = PAGE_WIDTH,
            h = 4f,
            fill = ACCENT,
        )

        var textX = MARGIN
        val logoImg = embedImage(doc, embeds.logo)
        if (logoImg != null) {
            val logoSize = 36f
            val scale = scaleToFit(logoImg.width.toFloat(), logoImg.height.toFloat(), logoSize, logoSize)
            stream.drawImage(logoImg, MARGIN, y - 36f, scale.first, scale.second)
            textX = MARGIN + scale.first + 12f
        }

        drawText(stream, tenant.legalName, textX, y - 24f, bold, 18f, INK)
        tenant.address?.takeIf { it.isNotBlank() }?.let {
            drawText(stream, it, textX, y - 42f, regular, 9f, MUTED)
        }
        val tenantMeta = listOfNotNull(
            tenant.gstin?.takeIf { it.isNotBlank() }?.let { "GSTIN $it" },
            tenant.phone?.takeIf { it.isNotBlank() }?.let { "Phone $it" },
        ).joinToString("   ")
        if (tenantMeta.isNotBlank()) {
            drawText(stream, tenantMeta, textX, y - 56f, regular, 9f, MUTED)
        }

        drawText(stream, "RECEIPT", PAGE_WIDTH - MARGIN - 96f, y - 30f, bold, 14f, MUTED)
        drawText(stream, receiptNo, PAGE_WIDTH - MARGIN - 220f, y - 50f, mono, 12f, INK)
        drawText(
            stream,
            formatCollectedAt(collection.collectedAtIso),
            PAGE_WIDTH - MARGIN - 220f,
            y - 64f,
            regular,
            9f,
            MUTED,
        )

        if (reversed) {
            // 60pt -25deg watermark across the page center. We use a
            // desaturated red rather than wiring up an extended graphics
            // state for opacity - same visual effect, much less PDFBox
            // surface to maintain.
            stream.beginText()
            stream.setFont(bold, 60f)
            stream.setNonStrokingColor(WATERMARK_R, WATERMARK_G, WATERMARK_B)
            stream.setTextMatrix(
                Matrix.getRotateInstance(
                    Math.toRadians(-25.0),
                    PAGE_WIDTH / 2f - 80f,
                    PAGE_HEIGHT / 2f - 20f,
                ),
            )
            stream.showText("REVERSED")
            stream.endText()
        }

        // Divider under the header.
        y = PAGE_HEIGHT - MARGIN - 100f
        drawLine(stream, MARGIN, y, PAGE_WIDTH - MARGIN, y, RULE, 0.5f)

        // -- Two-column block: received from + collected by --------------
        y -= 22f
        val colW = (PAGE_WIDTH - MARGIN * 2f) / 2f
        drawText(stream, "RECEIVED FROM", MARGIN, y, bold, 8.5f, MUTED)
        drawText(stream, customer?.name ?: collection.customerId, MARGIN, y - 16f, regular, 11f, INK)

        var cy = y - 30f
        customer?.code?.takeIf { it.isNotBlank() }?.let {
            drawText(stream, "Code $it", MARGIN, cy, mono, 9f, MUTED)
            cy -= 12f
        }
        customer?.address?.takeIf { it.isNotBlank() }?.let { addr ->
            val lines = wrapText(addr, colW - 8f, regular, 9f).take(2)
            for (line in lines) {
                drawText(stream, line, MARGIN, cy, regular, 9f, MUTED)
                cy -= 12f
            }
        }
        customer?.phone?.takeIf { it.isNotBlank() }?.let {
            drawText(stream, it, MARGIN, cy, regular, 9f, MUTED)
        }

        val rx = MARGIN + colW + 8f
        drawText(stream, "COLLECTED BY", rx, y, bold, 8.5f, MUTED)
        val agentName = agent.name?.takeIf { it.isNotBlank() } ?: "Agent ${collection.agentId.take(8)}"
        drawText(stream, agentName, rx, y - 16f, regular, 11f, INK)
        agent.agentCode?.takeIf { it.isNotBlank() }?.let {
            drawText(stream, "Agent $it", rx, y - 30f, mono, 9f, MUTED)
        }

        // -- Amount band -------------------------------------------------
        y -= 90f
        drawRect(
            stream,
            x = MARGIN,
            y = y - 8f,
            w = PAGE_WIDTH - MARGIN * 2f,
            h = 56f,
            fill = AMOUNT_BG,
            stroke = AMOUNT_BORDER,
            strokeWidth = 1f,
        )
        drawText(stream, "AMOUNT RECEIVED", MARGIN + 16f, y + 28f, bold, 8.5f, MUTED)
        drawText(stream, formatINR(collection.amount), MARGIN + 16f, y + 6f, bold, 22f, ACCENT)

        drawText(stream, "MODE", PAGE_WIDTH - MARGIN - 160f, y + 28f, bold, 8.5f, MUTED)
        drawText(stream, collection.paymentMode.display, PAGE_WIDTH - MARGIN - 160f, y + 8f, bold, 14f, INK)
        collection.refNo?.takeIf { it.isNotBlank() }?.let {
            drawText(stream, "Ref $it", PAGE_WIDTH - MARGIN - 160f, y - 6f, mono, 9f, MUTED)
        }

        // -- Meta rows: GPS / cheque date / remarks ----------------------
        y -= 36f
        val metaRows = buildList<Pair<String, String>> {
            val accuracy = collection.gpsAccuracyM
                ?.takeIf { it.isFinite() && it >= 0 }
                ?.let { "   (+/- ${"%.0f".format(it)} m)" }
                ?: ""
            add(
                "GPS" to (
                    "%.6f, %.6f".format(collection.collectionLat, collection.collectionLng) + accuracy
                    ),
            )
            collection.chequeDate?.takeIf { it.isNotBlank() }?.let { add("CHEQUE DATE" to it) }
            collection.remarks?.takeIf { it.isNotBlank() }?.let { add("REMARKS" to it) }
        }
        for ((label, value) in metaRows) {
            y -= 18f
            drawText(stream, label, MARGIN, y, bold, 8.5f, MUTED)
            // Long values (remarks especially) wrap rather than overflow.
            val lines = wrapText(value, PAGE_WIDTH - MARGIN * 2f - 90f, regular, 10f).take(2)
            var ly = y
            for ((idx, line) in lines.withIndex()) {
                drawText(stream, line, MARGIN + 90f, ly, regular, 10f, INK)
                if (idx < lines.size - 1) {
                    ly -= 12f
                    y -= 12f
                }
            }
        }

        // -- Attachments band (3 slots) ---------------------------------
        y -= 28f
        val slotW = (PAGE_WIDTH - MARGIN * 2f - 24f) / 3f
        val slotH = 130f
        val slotY = y - slotH

        drawAttachmentSlot(
            doc, stream, bold, regular,
            x = MARGIN,
            y = slotY,
            w = slotW,
            h = slotH,
            label = "PHOTO",
            asset = embeds.photo,
        )
        drawAttachmentSlot(
            doc, stream, bold, regular,
            x = MARGIN + slotW + 12f,
            y = slotY,
            w = slotW,
            h = slotH,
            label = "SIGNATURE",
            asset = embeds.signature,
        )
        drawAttachmentSlot(
            doc, stream, bold, regular,
            x = MARGIN + slotW * 2f + 24f,
            y = slotY,
            w = slotW,
            h = slotH,
            label = "GPS PIN",
            asset = embeds.mapThumbnail,
        )

        // -- QR code (verify link) --------------------------------------
        if (!verifyUrl.isNullOrBlank()) {
            val qrImg = embedQr(doc, embeds.qr)
            if (qrImg != null) {
                val qrSize = 72f
                val qrX = PAGE_WIDTH - MARGIN - qrSize
                val qrY = MARGIN + 56f
                stream.drawImage(qrImg, qrX, qrY, qrSize, qrSize)
                drawText(stream, "Scan to verify online", qrX - 100f, qrY + qrSize - 12f, bold, 9f, INK)
                drawText(
                    stream,
                    truncate(verifyUrl, 56),
                    qrX - 200f,
                    qrY + qrSize - 28f,
                    mono,
                    7f,
                    MUTED,
                )
            }
        }

        // -- Footer ------------------------------------------------------
        val footerY = MARGIN + 24f
        drawLine(stream, MARGIN, footerY + 24f, PAGE_WIDTH - MARGIN, footerY + 24f, RULE, 0.5f)
        drawText(
            stream,
            "This is a computer-generated receipt. The collection record is signed into the tenant's audit chain.",
            MARGIN,
            footerY,
            regular,
            8f,
            MUTED,
        )
        drawText(stream, "VCTS", PAGE_WIDTH - MARGIN - 32f, footerY, bold, 9f, MUTED)
        // Keep the legacy "Verify online via /r/<slug>/<no>" hint for
        // receipts that don't carry a verifyUrl (e.g. early devices that
        // can't reach /api/collections/{id}/receipt-assets).
        if (verifyUrl.isNullOrBlank()) {
            drawText(
                stream,
                "Verify online: /r/$tenantSlug/$receiptNo",
                MARGIN,
                footerY - 12f,
                regular,
                8f,
                MUTED,
            )
        }
    }

    // -- Drawing helpers -------------------------------------------------

    private fun drawText(
        stream: PDPageContentStream,
        text: String,
        x: Float,
        y: Float,
        font: PDFont,
        size: Float,
        color: FloatArray,
    ) {
        val safe = sanitiseForType1(text)
        if (safe.isEmpty()) return
        stream.beginText()
        stream.setFont(font, size)
        stream.setNonStrokingColor(color[0], color[1], color[2])
        stream.newLineAtOffset(x, y)
        stream.showText(safe)
        stream.endText()
    }

    private fun drawRect(
        stream: PDPageContentStream,
        x: Float,
        y: Float,
        w: Float,
        h: Float,
        fill: FloatArray? = null,
        stroke: FloatArray? = null,
        strokeWidth: Float = 0f,
    ) {
        if (fill != null) {
            stream.setNonStrokingColor(fill[0], fill[1], fill[2])
            stream.addRect(x, y, w, h)
            if (stroke != null && strokeWidth > 0f) {
                stream.setStrokingColor(stroke[0], stroke[1], stroke[2])
                stream.setLineWidth(strokeWidth)
                stream.fillAndStroke()
            } else {
                stream.fill()
            }
        } else if (stroke != null && strokeWidth > 0f) {
            stream.setStrokingColor(stroke[0], stroke[1], stroke[2])
            stream.setLineWidth(strokeWidth)
            stream.addRect(x, y, w, h)
            stream.stroke()
        }
    }

    private fun drawLine(
        stream: PDPageContentStream,
        x1: Float,
        y1: Float,
        x2: Float,
        y2: Float,
        color: FloatArray,
        width: Float,
    ) {
        stream.setStrokingColor(color[0], color[1], color[2])
        stream.setLineWidth(width)
        stream.moveTo(x1, y1)
        stream.lineTo(x2, y2)
        stream.stroke()
    }

    private fun drawAttachmentSlot(
        doc: PDDocument,
        stream: PDPageContentStream,
        bold: PDFont,
        regular: PDFont,
        x: Float,
        y: Float,
        w: Float,
        h: Float,
        label: String,
        asset: ImageAsset?,
    ) {
        drawRect(
            stream,
            x = x, y = y, w = w, h = h,
            fill = SLOT_BG,
            stroke = SLOT_BORDER,
            strokeWidth = 0.8f,
        )
        drawText(stream, label, x + 8f, y + h - 14f, bold, 8.5f, MUTED)

        val image = embedImage(doc, asset)
        if (image != null) {
            val padding = 8f
            val maxW = w - padding * 2f
            val maxH = h - padding * 2f - 12f
            val (iw, ih) = scaleToFit(image.width.toFloat(), image.height.toFloat(), maxW, maxH)
            stream.drawImage(image, x + (w - iw) / 2f, y + padding, iw, ih)
        } else {
            drawText(stream, "Not captured", x + 8f, y + h / 2f - 4f, regular, 9f, PLACEHOLDER)
        }
    }

    // -- Image embedding -------------------------------------------------

    private fun embedImage(doc: PDDocument, asset: ImageAsset?): PDImageXObject? {
        if (asset == null) return null
        return runCatching {
            when {
                asset.mime.equals("image/jpeg", ignoreCase = true) ||
                    asset.mime.equals("image/jpg", ignoreCase = true) ->
                    JPEGFactory.createFromStream(doc, ByteArrayInputStream(asset.bytes))

                else -> {
                    val bitmap = BitmapFactory.decodeByteArray(asset.bytes, 0, asset.bytes.size)
                        ?: return null
                    LosslessFactory.createFromImage(doc, bitmap).also { bitmap.recycle() }
                }
            }
        }
            .onFailure { Log.w(TAG, "embed image failed (${asset.mime}): ${it.message}") }
            .getOrNull()
    }

    private fun embedQr(doc: PDDocument, bitmap: Bitmap?): PDImageXObject? {
        if (bitmap == null) return null
        return runCatching { LosslessFactory.createFromImage(doc, bitmap) }
            .onFailure { Log.w(TAG, "embed QR failed: ${it.message}") }
            .getOrNull()
    }

    // -- Layout helpers --------------------------------------------------

    private fun scaleToFit(srcW: Float, srcH: Float, maxW: Float, maxH: Float): Pair<Float, Float> {
        if (srcW <= 0f || srcH <= 0f) return maxW to maxH
        val ratio = minOf(maxW / srcW, maxH / srcH)
        return srcW * ratio to srcH * ratio
    }

    private fun stringWidth(font: PDFont, text: String, fontSize: Float): Float =
        runCatching { font.getStringWidth(text) / 1000f * fontSize }.getOrDefault(0f)

    /**
     * Word-wrap helper. PDFBox doesn't provide one and the standard
     * fonts we use don't have ligatures, so a naive word boundary
     * tokenizer plus per-line width measurement is good enough.
     */
    private fun wrapText(text: String, maxWidth: Float, font: PDFont, fontSize: Float): List<String> {
        if (text.isBlank()) return emptyList()
        val safe = sanitiseForType1(text)
        if (safe.isBlank()) return emptyList()
        if (stringWidth(font, safe, fontSize) <= maxWidth) return listOf(safe)
        val words = safe.split(' ')
        val lines = mutableListOf<String>()
        val cur = StringBuilder()
        for (word in words) {
            val candidate = if (cur.isEmpty()) word else "${cur} $word"
            if (stringWidth(font, candidate, fontSize) <= maxWidth) {
                if (cur.isNotEmpty()) cur.append(' ')
                cur.append(word)
            } else {
                if (cur.isNotEmpty()) {
                    lines.add(cur.toString())
                    cur.clear()
                    cur.append(word)
                } else {
                    lines.add(word)
                }
            }
        }
        if (cur.isNotEmpty()) lines.add(cur.toString())
        return lines
    }

    /**
     * The Helvetica / Courier Type1 fonts shipped with PDFBox only
     * support WinAnsiEncoding (Latin-1 plus a handful of extras).
     * Anything outside that range throws at draw-time. We strip
     * unsupported code points rather than crashing the whole render.
     */
    private fun sanitiseForType1(input: String): String =
        input.map { c -> if (c.code in 0x20..0xFF || c == '\n') c else '?' }.joinToString("")

    private fun truncate(text: String, max: Int): String =
        if (text.length <= max) text else text.take(max - 1) + "\u2026"

    // -- Formatting helpers ----------------------------------------------

    private fun formatINR(amount: Double): String {
        val nf = NumberFormat.getInstance(Locale("en", "IN"))
        nf.minimumFractionDigits = 2
        nf.maximumFractionDigits = 2
        return "Rs. " + nf.format(amount)
    }

    private fun formatCollectedAt(iso: String): String {
        // Match the web template's `Date.toUTCString()` flavour: e.g.
        // "Tue, 01 Apr 2025 14:23:11 UTC". We render UTC explicitly so
        // the receipt date stays comparable across devices in different
        // timezones.
        return runCatching {
            val parser = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("UTC")
                isLenient = true
            }
            val date = try { parser.parse(iso) ?: Date() }
            catch (_: ParseException) {
                // Some clients emit ISO without millis - retry with a looser pattern.
                val alt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ssXXX", Locale.US).apply {
                    timeZone = TimeZone.getTimeZone("UTC")
                    isLenient = true
                }
                alt.parse(iso) ?: Date()
            }
            val cal = Calendar.getInstance(TimeZone.getTimeZone("UTC")).apply { time = date }
            val symbols = DateFormatSymbols(Locale.US)
            val day = symbols.shortWeekdays[cal.get(Calendar.DAY_OF_WEEK)]
            val mon = symbols.shortMonths[cal.get(Calendar.MONTH)]
            "%s, %02d %s %d %02d:%02d:%02d UTC".format(
                day,
                cal.get(Calendar.DAY_OF_MONTH),
                mon,
                cal.get(Calendar.YEAR),
                cal.get(Calendar.HOUR_OF_DAY),
                cal.get(Calendar.MINUTE),
                cal.get(Calendar.SECOND),
            )
        }.getOrDefault(iso)
    }

    private fun defaultTenant(slug: String): ReceiptTenantDto {
        // When the assets endpoint is unreachable we still want a
        // readable header. Title-cased slug is the same heuristic the
        // web verify page uses.
        val pretty = slug.split('-', '_').joinToString(" ") {
            it.replaceFirstChar(Char::titlecase)
        }
        return ReceiptTenantDto(legalName = pretty.ifBlank { "VCTS" })
    }

    private companion object {
        const val TAG = "ReceiptPdfRenderer"

        // A4 portrait in points.
        const val PAGE_WIDTH = 595.28f
        const val PAGE_HEIGHT = 841.89f
        const val MARGIN = 48f

        // Palette mirrored from the web template (web/src/lib/receipts/pdf.ts).
        val INK = floatArrayOf(0.07f, 0.09f, 0.12f)
        val MUTED = floatArrayOf(0.42f, 0.46f, 0.51f)
        val ACCENT = floatArrayOf(0.13f, 0.32f, 0.84f)
        val RULE = floatArrayOf(0.85f, 0.86f, 0.88f)
        val AMOUNT_BG = floatArrayOf(0.96f, 0.97f, 1.00f)
        val AMOUNT_BORDER = floatArrayOf(0.88f, 0.90f, 0.95f)
        val SLOT_BG = floatArrayOf(0.99f, 0.99f, 0.99f)
        val SLOT_BORDER = floatArrayOf(0.86f, 0.88f, 0.92f)
        val PLACEHOLDER = floatArrayOf(0.60f, 0.62f, 0.66f)

        // Web uses red @ 18% alpha over white; we substitute the
        // pre-blended colour here to stay clear of PDF's extended
        // graphics state machinery (one less surface to keep working).
        const val WATERMARK_R = 0.97f
        const val WATERMARK_G = 0.84f
        const val WATERMARK_B = 0.84f
    }
}
