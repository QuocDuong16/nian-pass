package dev.nian.pass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VaultSourcePolicyTest {
  @Test
  fun displayNameRemovesControlAndPathCharacters() {
    assertEquals("private\uFFFDvault\uFFFDname.kdbx", VaultSourcePolicy.displayName("private/vault\\name.kdbx"))
    assertEquals("vault\uFFFD.kdbx", VaultSourcePolicy.displayName("vault\n.kdbx"))
    assertEquals("Selected vault", VaultSourcePolicy.displayName(null))
  }

  @Test
  fun stagingNamesAreOpaqueAndManagedPrecisely() {
    val first = VaultSourcePolicy.opaqueId()
    val second = VaultSourcePolicy.opaqueId()
    assertNotEquals(first, second)
    assertTrue(VaultSourcePolicy.isManagedStagingName("$first.kdbx"))
    assertTrue(VaultSourcePolicy.isManagedStagingName("$first.partial"))
    assertFalse(VaultSourcePolicy.isManagedStagingName("MyPasswords.kdbx"))
    assertFalse(VaultSourcePolicy.isManagedStagingName("$first.kdbx.bak"))
  }

  @Test
  fun writableRequiresGrantedAndActuallyPersistedReadWriteAccess() {
    assertTrue(VaultSourcePolicy.isSafelyWritable(true, true, true, true, true))
    assertFalse(VaultSourcePolicy.isSafelyWritable(false, true, true, true, true))
    assertFalse(VaultSourcePolicy.isSafelyWritable(true, false, true, true, true))
    assertFalse(VaultSourcePolicy.isSafelyWritable(true, true, false, true, true))
    assertFalse(VaultSourcePolicy.isSafelyWritable(true, true, true, false, true))
    assertFalse(VaultSourcePolicy.isSafelyWritable(true, true, true, true, false))
  }

  @Test
  fun recoveryUsesOnlyExactEncryptedGenerations() {
    val baseline = "8:" + "aa".repeat(32)
    val candidate = "9:" + "bb".repeat(32)
    val unknown = "9:" + "cc".repeat(32)
    assertEquals(
      RecoveryDecision.ORIGINAL_KNOWN,
      VaultSourcePolicy.recoveryDecision(baseline, baseline, candidate),
    )
    assertEquals(
      RecoveryDecision.CANDIDATE_KNOWN,
      VaultSourcePolicy.recoveryDecision(candidate, baseline, candidate),
    )
    assertEquals(
      RecoveryDecision.REQUIRES_RECONCILIATION,
      VaultSourcePolicy.recoveryDecision(unknown, baseline, candidate),
    )
  }

  @Test
  fun transactionIdentifiersAndGenerationsAreStrict() {
    val id = VaultSourcePolicy.opaqueId()
    assertTrue(VaultSourcePolicy.isOpaqueId(id))
    assertTrue(VaultSourcePolicy.isTransactionName("$id.candidate"))
    assertTrue(VaultSourcePolicy.isJournalName("$id.journal"))
    assertTrue(VaultSourcePolicy.isGeneration("42:" + "01".repeat(32)))
    assertFalse(VaultSourcePolicy.isTransactionName("../$id.candidate"))
    assertFalse(VaultSourcePolicy.isGeneration("42:short"))
  }

  @Test
  fun providerWriteOutcomesFailClosed() {
    assertEquals(NativeCommitResult.VERIFIED, VaultSourcePolicy.finalReadResult(true))
    assertEquals(NativeCommitResult.SAVE_UNCERTAIN, VaultSourcePolicy.finalReadResult(false))
    assertEquals(NativeCommitResult.SAVE_FAILED, VaultSourcePolicy.destructiveFailureResult(true))
    assertEquals(
      NativeCommitResult.SAVE_UNCERTAIN,
      VaultSourcePolicy.destructiveFailureResult(false),
    )
  }
}
