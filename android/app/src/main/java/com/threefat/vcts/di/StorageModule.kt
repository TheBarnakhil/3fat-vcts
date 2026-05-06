package com.threefat.vcts.di

import android.content.Context
import com.threefat.vcts.data.preferences.AppPreferences
import com.threefat.vcts.data.preferences.SecureStore
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * On-device storage providers. Both stores are process-scoped singletons so
 * we never accidentally instantiate two EncryptedSharedPreferences clients
 * (which races on the master-key handle).
 */
@Module
@InstallIn(SingletonComponent::class)
object StorageModule {

    @Provides
    @Singleton
    fun provideAppPreferences(@ApplicationContext context: Context): AppPreferences =
        AppPreferences(context)

    @Provides
    @Singleton
    fun provideSecureStore(@ApplicationContext context: Context): SecureStore =
        SecureStore(context)
}
