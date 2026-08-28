package dev.nian.pass

import android.text.InputType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.SecureRandom
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class AutofillMetadataPolicyTest {
  private class TestCipher(private var key: SecretKey? = newKey()) : AutofillMetadataCipher {
    override fun encrypt(plaintext: ByteArray, aad: ByteArray): EncryptedMetadata {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, key ?: error("missing key"))
      cipher.updateAAD(aad)
      return EncryptedMetadata(cipher.iv, cipher.doFinal(plaintext))
    }

    override fun decrypt(record: EncryptedMetadata, aad: ByteArray): ByteArray {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(
        Cipher.DECRYPT_MODE,
        key ?: error("missing key"),
        GCMParameterSpec(128, record.iv),
      )
      cipher.updateAAD(aad)
      return cipher.doFinal(record.ciphertext)
    }

    fun removeKey() { key = null }

    private companion object {
      fun newKey(): SecretKey = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    }
  }

  private val aad = "dev.nian.pass|1|autofill-metadata".toByteArray()

  @Test
  fun metadataRoundTripAndFreshIvNeverExposePlaintext() {
    val metadata = AutofillMetadata(
      "content://synthetic/vault",
      3,
      "Synthetic.kdbx",
      listOf(AutofillAssociation("dev.example", "certificate-pin")),
    )
    val plaintext = AutofillMetadataCodec.encode(metadata)
    val cipher = TestCipher()
    val first = cipher.encrypt(plaintext, aad)
    val second = cipher.encrypt(plaintext, aad)
    assertNotEquals(first.iv.toList(), second.iv.toList())
    assertFalse(first.ciphertext.toString(Charsets.ISO_8859_1).contains("content://synthetic"))
    assertEquals(metadata, AutofillMetadataCodec.decode(cipher.decrypt(first, aad)))
  }

  @Test
  fun modifiedCiphertextIvWrongAadAndMissingKeyFailClosed() {
    val cipher = TestCipher()
    val record = cipher.encrypt(AutofillMetadataCodec.encode(AutofillMetadata("content://x", 1, "x")), aad)
    val changedCiphertext = record.copy(ciphertext = record.ciphertext.clone().also { it[0] = (it[0].toInt() xor 1).toByte() })
    val changedIv = record.copy(iv = record.iv.clone().also { it[0] = (it[0].toInt() xor 1).toByte() })
    assertFailsAead { cipher.decrypt(changedCiphertext, aad) }
    assertFailsAead { cipher.decrypt(changedIv, aad) }
    assertFailsAead { cipher.decrypt(record, "wrong".toByteArray()) }
    cipher.removeKey()
    assertTrue(runCatching { cipher.decrypt(record, aad) }.isFailure)
  }

  @Test
  fun corruptAndUnknownSchemaAreRejected() {
    val valid = AutofillMetadataCodec.encode(AutofillMetadata("content://x", 1, "x"))
    valid[3] = 2
    assertTrue(runCatching { AutofillMetadataCodec.decode(valid) }.isFailure)
    assertTrue(runCatching { AutofillMetadataCodec.decode(byteArrayOf(1, 2, 3)) }.isFailure)
  }

  private fun assertFailsAead(block: () -> Unit) {
    val error = runCatching(block).exceptionOrNull()
    assertTrue(error is AEADBadTagException)
  }
}

class AutofillRequestPolicyTest {
  @Test
  fun fieldClassifierRecognizesNarrowCredentialRoles() {
    assertEquals(
      AutofillFieldRole.USERNAME,
      AutofillFieldClassifier.classify(AutofillFieldModel(listOf("email"), 0, null)),
    )
    assertEquals(
      AutofillFieldRole.PASSWORD,
      AutofillFieldClassifier.classify(
        AutofillFieldModel(emptyList(), InputType.TYPE_TEXT_VARIATION_PASSWORD, null),
      ),
    )
    assertEquals(
      AutofillFieldRole.IGNORE,
      AutofillFieldClassifier.classify(AutofillFieldModel(listOf("name"), 0, "text")),
    )
  }

  @Test
  fun packageTrustRequiresBothExactPackageAndCertificate() {
    assertTrue(AutofillTrustPolicy.isTrusted("dev.example", "cert-a", "dev.example", "cert-a"))
    assertFalse(AutofillTrustPolicy.isTrusted("dev.example", "cert-a", "dev.example", "cert-b"))
    assertFalse(AutofillTrustPolicy.isTrusted("dev.example", "cert-a", "dev.example.evil", "cert-a"))
  }

  @Test
  fun requestAndCandidateTokensAreOpaqueSingleUseAndExpire() {
    var now = 1_000L
    val registry = AutofillRequestRegistry(clock = { now }, random = SecureRandom())
    val target = CredentialTarget(TargetKind.APP, "dev.example", "cert")
    val request = registry.registerAutofill(target, ParsedAutofillFields(emptyList(), emptyList()))
    val candidate = registry.registerCandidate(request, "entry")
    assertEquals(48, request.length)
    assertEquals("entry", registry.candidate(candidate, request)?.entryId)
    assertTrue(registry.complete(request, candidate) is AndroidRequestRecord.Autofill)
    assertNull(registry.complete(request, candidate))

    registry.clear()
    val reconstructed = registry.registerCredentialFulfillment(target)
    val reconstructedCandidate = registry.registerCandidate(reconstructed, "entry-after-restart")
    assertEquals(
      "entry-after-restart",
      registry.candidate(reconstructedCandidate, reconstructed)?.entryId,
    )
    assertTrue(
      registry.complete(reconstructed, reconstructedCandidate) is AndroidRequestRecord.Credential,
    )
    assertNull(registry.complete(reconstructed, reconstructedCandidate))

    val expired = registry.registerAutofill(target, ParsedAutofillFields(emptyList(), emptyList()))
    now += AutofillRequestRegistry.TTL_MILLIS + 1
    assertNull(registry.request(expired))
  }
}

class AutofillGrantPolicyTest {
  private class FakeGrantController(
    private var flags: Int,
    private val failRelease: Boolean = false,
  ) : PersistedGrantController {
    val releases = mutableListOf<Int>()

    override fun currentFlags(): Int = flags

    override fun release(flags: Int) {
      releases += flags
      if (failRelease) throw SecurityException("synthetic")
      this.flags = this.flags and flags.inv()
    }
  }

  @Test
  fun readWriteAndReadOnlySourcesBothBookmarkReadOnly() {
    assertEquals(AutofillGrantPolicy.READ, AutofillGrantPolicy.bookmarkFlags(
      AutofillGrantPolicy.READ or AutofillGrantPolicy.WRITE,
    ))
    assertEquals(
      AutofillGrantPolicy.READ,
      AutofillGrantPolicy.bookmarkFlags(AutofillGrantPolicy.READ),
    )
  }

  @Test
  fun sourceWithoutReadCannotEnableAutofill() {
    assertNull(AutofillGrantPolicy.bookmarkFlags(AutofillGrantPolicy.WRITE))
    assertNull(AutofillGrantPolicy.bookmarkFlags(0))
  }

  @Test
  fun coldRehydrateIsAlwaysReadOnly() {
    assertFalse(AutofillGrantPolicy.coldSourceWritable())
  }

  @Test
  fun rememberedLockReleasesWriteAndRetainsRead() {
    val grants = FakeGrantController(AutofillGrantPolicy.READ or AutofillGrantPolicy.WRITE)
    assertTrue(AutofillGrantPolicy.retainReadOnly(grants))
    assertEquals(listOf(AutofillGrantPolicy.WRITE), grants.releases)
    assertEquals(AutofillGrantPolicy.READ, grants.currentFlags())
  }

  @Test
  fun writeReleaseFailureAbortsNativeLockTransition() {
    val grants = FakeGrantController(
      AutofillGrantPolicy.READ or AutofillGrantPolicy.WRITE,
      failRelease = true,
    )
    assertFalse(AutofillGrantPolicy.retainReadOnly(grants))
    assertEquals(AutofillGrantPolicy.READ or AutofillGrantPolicy.WRITE, grants.currentFlags())
  }

  @Test
  fun disableDoesNotReleaseGrantOwnedByActiveNormalSession() {
    val both = AutofillGrantPolicy.READ or AutofillGrantPolicy.WRITE
    assertEquals(0, AutofillGrantPolicy.disableReleaseFlags(true, both))
    assertEquals(both, AutofillGrantPolicy.disableReleaseFlags(false, both))
  }

  @Test
  fun legacyReadWriteBookmarkNormalizesToReadOnly() {
    val legacy = AutofillMetadata("content://synthetic/vault", 3, "Synthetic.kdbx")
    assertEquals(AutofillGrantPolicy.READ, AutofillGrantPolicy.normalize(legacy)?.grantFlags)
  }
}
