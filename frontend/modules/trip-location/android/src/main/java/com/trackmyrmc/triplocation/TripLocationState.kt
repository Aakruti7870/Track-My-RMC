package com.trackmyrmc.triplocation

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONArray
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal data class TripLocationSnapshot(
  val tripId: String,
  val backendUrl: String,
  val token: String,
)

internal object TripLocationState {
  private const val PREFS = "tmrmc_trip_location_native"
  private const val KEY_ALIAS = "tmrmc_trip_location_aes_v1"
  private const val KEY_TRIP_ID = "trip_id"
  private const val KEY_BACKEND_URL = "backend_url"
  private const val KEY_TOKEN = "token_enc"
  private const val KEY_QUEUE = "queue_enc"
  private const val MAX_QUEUE_SIZE = 100

  fun save(context: Context, tripId: String, backendUrl: String, token: String) {
    require(tripId.isNotBlank()) { "tripId is required" }
    require(backendUrl.startsWith("https://")) { "Trip location backend must use HTTPS" }
    require(token.isNotBlank()) { "token is required" }

    prefs(context).edit()
      .putString(KEY_TRIP_ID, tripId)
      .putString(KEY_BACKEND_URL, backendUrl.trimEnd('/'))
      .putString(KEY_TOKEN, encrypt(token))
      .apply()
  }

  fun snapshot(context: Context): TripLocationSnapshot? {
    val prefs = prefs(context)
    val tripId = prefs.getString(KEY_TRIP_ID, null)?.takeIf { it.isNotBlank() } ?: return null
    val backendUrl = prefs.getString(KEY_BACKEND_URL, null)?.takeIf { it.startsWith("https://") } ?: return null
    val encryptedToken = prefs.getString(KEY_TOKEN, null) ?: return null
    val token = runCatching { decrypt(encryptedToken) }.getOrNull()?.takeIf { it.isNotBlank() } ?: return null
    return TripLocationSnapshot(tripId, backendUrl, token)
  }

  fun clear(context: Context) {
    prefs(context).edit().clear().apply()
  }

  fun enqueue(context: Context, payload: String) {
    val queue = readQueue(context).toMutableList()
    queue.add(payload)
    while (queue.size > MAX_QUEUE_SIZE) {
      queue.removeAt(0)
    }
    writeQueue(context, queue)
  }

  fun readQueue(context: Context): List<String> {
    val encrypted = prefs(context).getString(KEY_QUEUE, null) ?: return emptyList()
    val raw = runCatching { decrypt(encrypted) }.getOrNull() ?: return emptyList()
    return runCatching {
      val array = JSONArray(raw)
      buildList(array.length()) {
        for (index in 0 until array.length()) {
          add(array.getString(index))
        }
      }
    }.getOrDefault(emptyList())
  }

  fun writeQueue(context: Context, queue: List<String>) {
    if (queue.isEmpty()) {
      prefs(context).edit().remove(KEY_QUEUE).apply()
      return
    }
    val array = JSONArray()
    queue.forEach { payload -> array.put(payload) }
    prefs(context).edit().putString(KEY_QUEUE, encrypt(array.toString())).apply()
  }

  private fun prefs(context: Context) =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun encrypt(value: String): String {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
    val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
    val ciphertext = Base64.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
    return "$iv:$ciphertext"
  }

  private fun decrypt(value: String): String {
    val parts = value.split(':', limit = 2)
    require(parts.size == 2) { "Invalid encrypted value" }
    val iv = Base64.decode(parts[0], Base64.NO_WRAP)
    val ciphertext = Base64.decode(parts[1], Base64.NO_WRAP)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(128, iv))
    return String(cipher.doFinal(ciphertext), Charsets.UTF_8)
  }

  private fun getOrCreateKey(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        KEY_ALIAS,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .build(),
    )
    return generator.generateKey()
  }
}
