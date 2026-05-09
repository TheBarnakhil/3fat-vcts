package com.threefat.vcts.di

import javax.inject.Qualifier

/**
 * Hilt qualifier for the OkHttpClient that talks directly to Cloudflare
 * R2 presigned URLs. See [NetworkModule.provideR2UploadClient].
 */
@Qualifier
@Retention(AnnotationRetention.BINARY)
annotation class R2UploadClient
