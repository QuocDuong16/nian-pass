package dev.nian.pass

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal data class AutofillAssociation(
  val packageName: String,
  val signingIdentity: String,
)

internal data class AutofillMetadata(
  val sourceUri: String,
  val grantFlags: Int,
  val displayName: String,
  val associations: List<AutofillAssociation> = emptyList(),
)

internal data class EncryptedMetadata(val iv: ByteArray, val ciphertext: ByteArray)

internal interface AutofillMetadataCipher {
  fun encrypt(plaintext: ByteArray, aad: ByteArray): EncryptedMetadata
  fun decrypt(record: EncryptedMetadata, aad: ByteArray): ByteArray
}

/** Versioned binary codec with strict bounds; it never writes source plaintext itself. */
internal object AutofillMetadataCodec {
  private const val SCHEMA = 1
  private const val MAX_TEXT = 16_384
  private const val MAX_ASSOCIATIONS = 1_024

  fun encode(value: AutofillMetadata): ByteArray {
    val output = ByteArrayOutputStream()
    DataOutputStream(output).use { stream ->
      stream.writeInt(SCHEMA)
      stream.writeText(value.sourceUri)
      stream.writeInt(value.grantFlags)
      stream.writeText(value.displayName)
      stream.writeInt(value.associations.size)
      value.associations.forEach { association ->
        stream.writeText(association.packageName)
        stream.writeText(association.signingIdentity)
      }
    }
    return output.toByteArray()
  }

  fun decode(bytes: ByteArray): AutofillMetadata {
    DataInputStream(ByteArrayInputStream(bytes)).use { stream ->
      if (stream.readInt() != SCHEMA) throw IllegalArgumentException("schema")
      val sourceUri = stream.readText()
      val grantFlags = stream.readInt()
      val displayName = stream.readText()
      val count = stream.readInt()
      if (count !in 0..MAX_ASSOCIATIONS) throw IllegalArgumentException("associations")
      val associations = List(count) {
        AutofillAssociation(stream.readText(), stream.readText())
      }
      if (stream.available() != 0 || sourceUri.isEmpty()) throw IllegalArgumentException("payload")
      return AutofillMetadata(sourceUri, grantFlags, displayName, associations)
    }
  }

  private fun DataOutputStream.writeText(value: String) {
    val bytes = value.toByteArray(Charsets.UTF_8)
    if (bytes.size > MAX_TEXT) throw IllegalArgumentException("text")
    writeInt(bytes.size)
    write(bytes)
  }

  private fun DataInputStream.readText(): String {
    val length = readInt()
    if (length !in 0..MAX_TEXT || length > available()) throw IllegalArgumentException("text")
    val bytes = ByteArray(length)
    readFully(bytes)
    return bytes.toString(Charsets.UTF_8)
  }
}

internal class AndroidKeystoreAutofillCipher(
  private val alias: String = ALIAS,
) : AutofillMetadataCipher {
  override fun encrypt(plaintext: ByteArray, aad: ByteArray): EncryptedMetadata {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, key(create = true))
    cipher.updateAAD(aad)
    return EncryptedMetadata(cipher.iv.clone(), cipher.doFinal(plaintext))
  }

  override fun decrypt(record: EncryptedMetadata, aad: ByteArray): ByteArray {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, key(create = false), GCMParameterSpec(128, record.iv))
    cipher.updateAAD(aad)
    return cipher.doFinal(record.ciphertext)
  }

  private fun key(create: Boolean): SecretKey {
    val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    if (!create) throw IllegalStateException("missing key")
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(
        alias,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setKeySize(256)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .setUserAuthenticationRequired(false)
        .build(),
    )
    return generator.generateKey()
  }

  companion object {
    internal const val ALIAS = "nian-pass-autofill-metadata-v1"
    private const val KEYSTORE = "AndroidKeyStore"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
  }
}

/** Keystore-encrypted source bookmark and package trust pins in no-backup storage. */
internal class AutofillMetadataStore(
  context: Context,
  private val cipher: AutofillMetadataCipher = AndroidKeystoreAutofillCipher(),
  fileName: String = FILE_NAME,
) {
  private val file = AtomicFile(File(context.noBackupFilesDir, fileName))

  @Synchronized
  fun saveBookmark(metadata: AutofillMetadata): Boolean = try {
    val normalized = AutofillGrantPolicy.normalize(metadata) ?: return false
    val plaintext = AutofillMetadataCodec.encode(normalized)
    try {
      writeEnvelope(cipher.encrypt(plaintext, AAD))
    } finally {
      plaintext.fill(0)
    }
    true
  } catch (_: Exception) {
    false
  }

  @Synchronized
  fun loadBookmark(): AutofillMetadata? {
    if (!file.baseFile.isFile) return null
    return try {
      val plaintext = cipher.decrypt(readEnvelope(file.readFully()), AAD)
      try {
        val decoded = AutofillMetadataCodec.decode(plaintext)
        val normalized = AutofillGrantPolicy.normalize(decoded) ?: return null
        if (normalized != decoded && !saveBookmark(normalized)) return null
        normalized
      } finally {
        plaintext.fill(0)
      }
    } catch (_: Exception) {
      null
    }
  }

  @Synchronized
  fun deleteBookmark(): Boolean = try {
    file.delete()
    !file.baseFile.exists()
  } catch (_: Exception) {
    false
  }

  @Synchronized
  fun saveAssociation(packageName: String, signingIdentity: String): Boolean {
    val current = loadBookmark() ?: return false
    val next = current.associations.filterNot { it.packageName == packageName } +
      AutofillAssociation(packageName, signingIdentity)
    return saveBookmark(current.copy(associations = next))
  }

  @Synchronized
  fun isTrusted(packageName: String, signingIdentity: String): Boolean =
    loadBookmark()?.associations?.any {
      it.packageName == packageName && it.signingIdentity == signingIdentity
    } == true

  private fun writeEnvelope(record: EncryptedMetadata) {
    require(record.iv.size == IV_SIZE)
    require(record.ciphertext.isNotEmpty() && record.ciphertext.size <= MAX_CIPHERTEXT)
    val stream = file.startWrite()
    try {
      val output = DataOutputStream(stream)
      output.writeInt(ENVELOPE_VERSION)
      output.writeInt(record.iv.size)
      output.write(record.iv)
      output.writeInt(record.ciphertext.size)
      output.write(record.ciphertext)
      output.flush()
      file.finishWrite(stream)
    } catch (error: Exception) {
      file.failWrite(stream)
      throw error
    }
  }

  private fun readEnvelope(bytes: ByteArray): EncryptedMetadata {
    DataInputStream(ByteArrayInputStream(bytes)).use { input ->
      if (input.readInt() != ENVELOPE_VERSION) throw IllegalArgumentException("envelope")
      val ivLength = input.readInt()
      if (ivLength != IV_SIZE || ivLength > input.available()) throw IllegalArgumentException("iv")
      val iv = ByteArray(ivLength).also(input::readFully)
      val ciphertextLength = input.readInt()
      if (ciphertextLength !in 1..MAX_CIPHERTEXT || ciphertextLength > input.available()) {
        throw IllegalArgumentException("ciphertext")
      }
      val ciphertext = ByteArray(ciphertextLength).also(input::readFully)
      if (input.available() != 0) throw IllegalArgumentException("trailing")
      return EncryptedMetadata(iv, ciphertext)
    }
  }

  companion object {
    private const val FILE_NAME = "nian-pass-autofill-metadata-v1.bin"
    private const val ENVELOPE_VERSION = 1
    private const val IV_SIZE = 12
    private const val MAX_CIPHERTEXT = 131_072
    private val AAD = "dev.nian.pass|1|autofill-metadata".toByteArray(Charsets.UTF_8)
  }
}
