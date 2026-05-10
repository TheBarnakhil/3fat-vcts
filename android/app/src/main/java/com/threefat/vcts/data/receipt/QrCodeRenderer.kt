package com.threefat.vcts.data.receipt

import android.graphics.Bitmap
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Phase 10 / Track C1 - generates QR codes used by the on-device PDF
 * renderer. Mirrors the web template: medium error-correction, 1-px
 * margin, ink black on paper white. Returns a `Bitmap` so the caller
 * can hand it to PDFBox-Android via `LosslessFactory.createFromImage`.
 */
@Singleton
class QrCodeRenderer @Inject constructor() {

    fun render(content: String, sizePx: Int = 240): Bitmap {
        val writer = QRCodeWriter()
        val hints = mapOf(
            EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M,
            EncodeHintType.MARGIN to 1,
            EncodeHintType.CHARACTER_SET to "UTF-8",
        )
        val matrix = writer.encode(content, BarcodeFormat.QR_CODE, sizePx, sizePx, hints)
        val bitmap = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
        for (x in 0 until sizePx) {
            for (y in 0 until sizePx) {
                bitmap.setPixel(
                    x,
                    y,
                    if (matrix[x, y]) INK_COLOR else PAPER_COLOR,
                )
            }
        }
        return bitmap
    }

    companion object {
        private const val INK_COLOR = 0xFF0F172A.toInt() // slate-900
        private const val PAPER_COLOR = 0xFFFFFFFF.toInt()
    }
}
