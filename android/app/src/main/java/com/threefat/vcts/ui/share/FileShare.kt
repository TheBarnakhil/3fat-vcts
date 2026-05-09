package com.threefat.vcts.ui.share

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.Toast
import androidx.core.content.FileProvider
import com.threefat.vcts.R
import java.io.File
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * Phase 8 share helpers. We hand the receipt PDF to other apps via a
 * FileProvider URI rather than letting them read our private cache
 * directly. The authority is declared in AndroidManifest.xml and MUST
 * stay in sync with [FILE_PROVIDER_AUTHORITY] below.
 */
object FileShare {

    private const val FILE_PROVIDER_AUTHORITY_SUFFIX = ".fileprovider"

    fun authority(context: Context): String =
        "${context.packageName}$FILE_PROVIDER_AUTHORITY_SUFFIX"

    fun pdfUri(context: Context, file: File): Uri =
        FileProvider.getUriForFile(context, authority(context), file)

    /**
     * Opens the system share sheet with the receipt PDF + a default
     * caption. Apps that handle `application/pdf` (WhatsApp, Drive,
     * Gmail, the system print spooler) all show up in the chooser.
     */
    fun shareReceiptPdf(
        context: Context,
        file: File,
        receiptNo: String?,
        verifyUrl: String?,
    ) {
        val uri = pdfUri(context, file)
        val text = buildShareText(context, receiptNo, verifyUrl)
        val intent = Intent(Intent.ACTION_SEND).apply {
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_TEXT, text)
            putExtra(
                Intent.EXTRA_SUBJECT,
                context.getString(R.string.share_subject, receiptNo ?: ""),
            )
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
            context.startActivity(
                Intent.createChooser(intent, context.getString(R.string.share_via)),
            )
        } catch (e: ActivityNotFoundException) {
            Toast.makeText(
                context,
                context.getString(R.string.share_no_apps),
                Toast.LENGTH_LONG,
            ).show()
        }
    }

    /**
     * WhatsApp deep link with pre-filled text. Falls back to the system
     * share sheet if WhatsApp is not installed - we don't mandate it
     * because some agents may rely on Telegram / Signal instead.
     */
    fun shareReceiptToWhatsApp(
        context: Context,
        file: File,
        receiptNo: String?,
        verifyUrl: String?,
    ) {
        val uri = pdfUri(context, file)
        val text = buildShareText(context, receiptNo, verifyUrl)
        val intent = Intent(Intent.ACTION_SEND).apply {
            setPackage("com.whatsapp")
            type = "application/pdf"
            putExtra(Intent.EXTRA_STREAM, uri)
            putExtra(Intent.EXTRA_TEXT, text)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
            context.startActivity(intent)
        } catch (_: ActivityNotFoundException) {
            shareReceiptPdf(context, file, receiptNo, verifyUrl)
        }
    }

    /**
     * Copies the receipt PDF into the app's private `filesDir/Downloads`
     * folder so it survives cache eviction, then opens the system share
     * sheet to "Save to Files" / Drive. We deliberately don't attempt
     * `MediaStore.Downloads` because that requires additional storage
     * permissions on older Android versions; the Files share target
     * gives the user control over where it lands.
     */
    fun saveReceiptToDownloads(context: Context, source: File): File? {
        return try {
            val downloads = File(context.filesDir, "Downloads").apply { mkdirs() }
            val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
            val target = File(downloads, "vcts-receipt-$stamp.pdf")
            FileOutputStream(target).use { out ->
                source.inputStream().use { it.copyTo(out) }
            }
            target
        } catch (_: Throwable) {
            null
        }
    }

    private fun buildShareText(
        context: Context,
        receiptNo: String?,
        verifyUrl: String?,
    ): String {
        val template = context.getString(R.string.share_text_template)
        val rn = receiptNo ?: ""
        val link = verifyUrl ?: ""
        return template
            .replace("{receipt}", rn)
            .replace("{url}", link)
            .trim()
    }
}
