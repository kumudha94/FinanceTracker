package com.mytracker.finance.widgetbridge

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/**
 * Widget copy of the app's auth tokens, in EncryptedSharedPreferences.
 *
 * This store must never throw to its callers. An unreadable store (its keyset can't be
 * decrypted — e.g. the prefs file was restored by Android Auto Backup onto a device whose
 * Keystore master key was never backed up, or it was corrupted by concurrent first-time
 * creation) used to throw on every access: the widgets' update job crashed before writing
 * any state (stuck on "Loading…"), and the app treated the throw as a failed token refresh
 * and signed the user out. Instead, a broken store is deleted and recreated empty; the app
 * repopulates it on its next token store/refresh.
 */
object WidgetAuthPrefs {
  private const val TAG = "WidgetAuthPrefs"
  private const val PREFS_FILE_NAME = "widget_auth_prefs"
  private const val KEY_ACCESS_TOKEN = "access_token"
  private const val KEY_REFRESH_TOKEN = "refresh_token"

  // Built once and shared across the app's JS bridge calls and the widgets' workers,
  // so the MasterKey/Tink keyset setup never races with itself.
  @Volatile private var cached: SharedPreferences? = null

  private fun prefs(context: Context): SharedPreferences? {
    cached?.let { return it }
    return synchronized(this) {
      cached ?: openOrReset(context.applicationContext)?.also { cached = it }
    }
  }

  private fun openOrReset(context: Context): SharedPreferences? {
    return try {
      create(context)
    } catch (e: Exception) {
      Log.w(TAG, "Widget auth store unreadable, resetting it", e)
      try {
        context.deleteSharedPreferences(PREFS_FILE_NAME)
        create(context)
      } catch (e2: Exception) {
        Log.e(TAG, "Widget auth store could not be recreated", e2)
        null
      }
    }
  }

  private fun create(context: Context): SharedPreferences {
    val masterKey = MasterKey.Builder(context)
      .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
      .build()

    return EncryptedSharedPreferences.create(
      context,
      PREFS_FILE_NAME,
      masterKey,
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
    )
  }

  // A store that opened fine can still hold individual entries that fail to decrypt.
  // Treat that the same way: drop the store and report "nothing stored".
  private fun <T> guarded(context: Context, fallback: T, block: (SharedPreferences) -> T): T {
    val store = prefs(context) ?: return fallback
    return try {
      block(store)
    } catch (e: Exception) {
      Log.w(TAG, "Widget auth store access failed, resetting it", e)
      synchronized(this) {
        cached = null
        try {
          context.applicationContext.deleteSharedPreferences(PREFS_FILE_NAME)
        } catch (_: Exception) {
        }
      }
      fallback
    }
  }

  fun setTokens(context: Context, accessToken: String, refreshToken: String) {
    guarded(context, Unit) {
      it.edit()
        .putString(KEY_ACCESS_TOKEN, accessToken)
        .putString(KEY_REFRESH_TOKEN, refreshToken)
        .apply()
    }
  }

  fun setAccessToken(context: Context, accessToken: String) {
    guarded(context, Unit) {
      it.edit()
        .putString(KEY_ACCESS_TOKEN, accessToken)
        .apply()
    }
  }

  fun getAccessToken(context: Context): String? =
    guarded(context, null) { it.getString(KEY_ACCESS_TOKEN, null) }

  fun getRefreshToken(context: Context): String? =
    guarded(context, null) { it.getString(KEY_REFRESH_TOKEN, null) }

  fun clear(context: Context) {
    guarded(context, Unit) { it.edit().clear().apply() }
  }
}
