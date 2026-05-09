package com.threefat.vcts.di

import com.jakewharton.retrofit2.converter.kotlinx.serialization.asConverterFactory
import com.threefat.vcts.BuildConfig
import com.threefat.vcts.data.remote.AuthApi
import com.threefat.vcts.data.remote.CollectionsApi
import com.threefat.vcts.data.remote.CustomersApi
import com.threefat.vcts.data.remote.LocationLogsApi
import com.threefat.vcts.data.remote.SyncApi
import com.threefat.vcts.data.remote.interceptor.AuthInterceptor
import com.threefat.vcts.data.remote.interceptor.TokenRefreshAuthenticator
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import kotlinx.serialization.json.Json
import okhttp3.CertificatePinner
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.logging.HttpLoggingInterceptor
import retrofit2.Retrofit
import java.util.concurrent.TimeUnit
import javax.inject.Singleton

/**
 * HTTP transport. The OkHttp client is the single instance shared by every
 * Retrofit service, which keeps connection-pool churn in check.
 *
 * Pinning behaviour:
 *  - Debug builds run with no pins so engineers can attach a debugging proxy.
 *  - Release builds load pins from BuildConfig.API_CERT_PINS. The placeholder
 *    pin in app/build.gradle.kts forces the release build to fail handshake
 *    until we drop in real SPKI hashes during Phase 10 hardening.
 */
@Module
@InstallIn(SingletonComponent::class)
object NetworkModule {

    @Provides
    @Singleton
    fun provideJson(): Json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = false
        explicitNulls = false
        coerceInputValues = true
    }

    @Provides
    @Singleton
    fun provideHttpLoggingInterceptor(): HttpLoggingInterceptor =
        HttpLoggingInterceptor().apply {
            level = if (BuildConfig.DEBUG) {
                HttpLoggingInterceptor.Level.BASIC
            } else {
                HttpLoggingInterceptor.Level.NONE
            }
        }

    @Provides
    @Singleton
    fun provideCertificatePinner(): CertificatePinner {
        if (BuildConfig.DEBUG) return CertificatePinner.Builder().build()
        val pins = BuildConfig.API_CERT_PINS
        if (pins.isEmpty()) return CertificatePinner.Builder().build()
        val host = BuildConfig.API_BASE_URL
            .removePrefix("https://")
            .removePrefix("http://")
            .substringBefore('/')
        return CertificatePinner.Builder()
            .apply { pins.forEach { add(host, it) } }
            .build()
    }

    @Provides
    @Singleton
    fun provideOkHttpClient(
        authInterceptor: AuthInterceptor,
        loggingInterceptor: HttpLoggingInterceptor,
        certificatePinner: CertificatePinner,
        tokenRefreshAuthenticator: TokenRefreshAuthenticator,
    ): OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .certificatePinner(certificatePinner)
        .addInterceptor(authInterceptor)
        .addInterceptor(loggingInterceptor)
        .authenticator(tokenRefreshAuthenticator)
        .build()

    @Provides
    @Singleton
    fun provideRetrofit(client: OkHttpClient, json: Json): Retrofit =
        Retrofit.Builder()
            .baseUrl(BuildConfig.API_BASE_URL)
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build()

    @Provides
    @Singleton
    fun provideAuthApi(retrofit: Retrofit): AuthApi = retrofit.create(AuthApi::class.java)

    @Provides
    @Singleton
    fun provideCustomersApi(retrofit: Retrofit): CustomersApi =
        retrofit.create(CustomersApi::class.java)

    @Provides
    @Singleton
    fun provideCollectionsApi(retrofit: Retrofit): CollectionsApi =
        retrofit.create(CollectionsApi::class.java)

    @Provides
    @Singleton
    fun provideSyncApi(retrofit: Retrofit): SyncApi =
        retrofit.create(SyncApi::class.java)

    @Provides
    @Singleton
    fun provideLocationLogsApi(retrofit: Retrofit): LocationLogsApi =
        retrofit.create(LocationLogsApi::class.java)
}
