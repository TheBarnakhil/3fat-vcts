package com.threefat.vcts.data.receipt

import android.util.Log
import com.threefat.vcts.data.remote.ReceiptAssetsApi
import com.threefat.vcts.data.remote.dto.PresignedAssetDto
import com.threefat.vcts.data.remote.dto.ReceiptAssetsResponse
import com.threefat.vcts.di.R2UploadClient
import com.threefat.vcts.domain.model.CollectionRecord
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

/**
 * Phase 10 / Track C1.
 *
 * Resolves the binary blobs the on-device PDF renderer needs to embed:
 *
 * - **Logo + photo + signature** come either from the local cache
 *   (the device only just captured them) or from a presigned R2 GET
 *   URL we asked the server for. Local always wins because (a) we
 *   already paid the network for them, and (b) the device might be
 *   offline when re-rendering. Each remote miss silently falls back
 *   to "Not captured" - never an error.
 *
 * - **Static map thumbnail** is fetched via the server proxy at
 *   `/api/maps/static`; the Maps API key never ships in the APK.
 *
 * - **QR code** is rendered locally via [QrCodeRenderer] from the
 *   verifyUrl when one is available.
 *
 * Everything runs on Dispatchers.IO and is wrapped in `runCatching`
 * so a single bad fetch never tanks the whole receipt render.
 */
@Singleton
class ReceiptAssetsLoader @Inject constructor(
    private val receiptAssetsApi: ReceiptAssetsApi,
    private val qrRenderer: QrCodeRenderer,
    @R2UploadClient private val externalHttpClient: OkHttpClient,
) {

    /**
     * Hits `/api/collections/{id}/receipt-assets`. Returns null on any
     * failure - the renderer keeps going with whatever local context it
     * has (the public verification URL is computable on-device too).
     */
    suspend fun fetchMetadata(collectionId: String): ReceiptAssetsResponse? =
        runCatching { receiptAssetsApi.assets(collectionId) }
            .onFailure {
                Log.w(TAG, "receipt-assets metadata failed for $collectionId: ${it.message}")
            }
            .getOrNull()

    /**
     * Resolves all embeddable images in parallel. Fan-out is fine here
     * because the device's HTTP client pool is plenty wide for four
     * concurrent fetches and each downstream is independent.
     */
    suspend fun loadEmbeds(
        collection: CollectionRecord,
        metadata: ReceiptAssetsResponse?,
        verifyUrl: String?,
    ): ReceiptEmbedAssets = coroutineScope {
        val logoDeferred = async(Dispatchers.IO) { fetchPresigned(metadata?.logo) }
        val photoDeferred = async(Dispatchers.IO) {
            preferLocalThenRemote(
                localPath = collection.photoLocalPath,
                fallback = metadata?.photo,
                fallbackMimeWhenLocal = "image/jpeg",
            )
        }
        val signatureDeferred = async(Dispatchers.IO) {
            preferLocalThenRemote(
                localPath = collection.signatureLocalPath,
                fallback = metadata?.signature,
                fallbackMimeWhenLocal = "image/png",
            )
        }
        val mapDeferred = async(Dispatchers.IO) {
            fetchStaticMap(
                lat = collection.collectionLat,
                lng = collection.collectionLng,
            )
        }
        val qrDeferred = async(Dispatchers.IO) {
            if (verifyUrl.isNullOrBlank()) return@async null
            runCatching { qrRenderer.render(verifyUrl, sizePx = 240) }
                .onFailure { Log.w(TAG, "QR render failed: ${it.message}") }
                .getOrNull()
        }

        ReceiptEmbedAssets(
            logo = logoDeferred.await(),
            photo = photoDeferred.await(),
            signature = signatureDeferred.await(),
            mapThumbnail = mapDeferred.await(),
            qr = qrDeferred.await(),
        )
    }

    private suspend fun preferLocalThenRemote(
        localPath: String?,
        fallback: PresignedAssetDto?,
        fallbackMimeWhenLocal: String,
    ): ImageAsset? {
        if (!localPath.isNullOrBlank()) {
            val file = File(localPath)
            if (file.exists() && file.length() > 0) {
                return runCatching {
                    ImageAsset(file.readBytes(), fallbackMimeWhenLocal)
                }
                    .onFailure { Log.w(TAG, "read local $localPath failed: ${it.message}") }
                    .getOrNull()
            }
        }
        return fetchPresigned(fallback)
    }

    private suspend fun fetchPresigned(asset: PresignedAssetDto?): ImageAsset? {
        if (asset == null) return null
        return withContext(Dispatchers.IO) {
            runCatching {
                val req = Request.Builder().url(asset.url).get().build()
                externalHttpClient.newCall(req).execute().use { resp ->
                    if (!resp.isSuccessful) return@use null
                    val bytes = resp.body?.bytes() ?: return@use null
                    ImageAsset(bytes, asset.mime)
                }
            }
                .onFailure { Log.w(TAG, "presigned fetch failed: ${it.message}") }
                .getOrNull()
        }
    }

    private suspend fun fetchStaticMap(lat: Double, lng: Double): ImageAsset? = runCatching {
        val body = receiptAssetsApi.staticMap(lat = lat, lng = lng)
        body.use { ImageAsset(it.bytes(), "image/png") }
    }
        .onFailure { Log.w(TAG, "static-map fetch failed: ${it.message}") }
        .getOrNull()

    private companion object {
        const val TAG = "ReceiptAssetsLoader"
    }
}
