package com.threefat.vcts.data.local

import android.content.Context
import android.util.Base64
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import dagger.hilt.android.qualifiers.ApplicationContext
import java.security.SecureRandom
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Supplies the 32-byte passphrase used to open the SQLCipher-encrypted Room
 * database.
 *
 * Threat model:
 *   - The passphrase itself is generated once per install via
 *     [SecureRandom] (256 bits of entropy) and stored in a
 *     Keystore-backed [EncryptedSharedPreferences] file. The Keystore key
 *     is hardware-backed on TEE / StrongBox devices, software-backed on
 *     older phones - in both cases an attacker with physical access still
 *     needs to bypass the lockscreen and root the device to extract it.
 *   - We deliberately do NOT derive the passphrase from a user-entered
 *     PIN: the agent already authenticates against our backend, and forcing
 *     a second factor at every cold start would push them to "remember
 *     password" hacks that defeat the point.
 *
 * SQLCipher accepts either a UTF-8 passphrase or a raw byte array. We use
 * the raw-byte path so the random generator's output isn't munged by any
 * implicit encoding. The persisted form is base64 because
 * EncryptedSharedPreferences only stores strings.
 */
@Singleton
class DatabaseKeyProvider @Inject constructor(
    @ApplicationContext context: Context,
) {
    private val masterKey: MasterKey = MasterKey.Builder(context)
        .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
        .build()

    private val prefs = EncryptedSharedPreferences.create(
        context,
        FILE_NAME,
        masterKey,
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    )

    /**
     * Returns the 32-byte SQLCipher passphrase, generating + persisting one
     * if this is the first call on a given install. Safe to call from any
     * thread; subsequent calls are pure reads of an in-memory cipher.
     */
    @Synchronized
    fun getOrCreatePassphrase(): ByteArray {
        val existing = prefs.getString(KEY_DB_PASSPHRASE, null)
        if (existing != null) {
            return Base64.decode(existing, Base64.NO_WRAP)
        }
        val bytes = ByteArray(KEY_LENGTH_BYTES).also { SecureRandom().nextBytes(it) }
        prefs
            .edit()
            .putString(KEY_DB_PASSPHRASE, Base64.encodeToString(bytes, Base64.NO_WRAP))
            .apply()
        return bytes
    }

    /**
     * Drops the persisted passphrase. The next call to
     * [getOrCreatePassphrase] will generate a new one - effectively
     * orphaning every existing encrypted DB on disk. Use only when wiping
     * a tenant or recovering from a forensic-cleanup event; never as a
     * routine logout step.
     */
    fun rotate() {
        prefs.edit().remove(KEY_DB_PASSPHRASE).apply()
    }

    companion object {
        private const val FILE_NAME = "vcts_db_key_prefs"
        private const val KEY_DB_PASSPHRASE = "db_passphrase_b64"
        private const val KEY_LENGTH_BYTES = 32
    }
}
