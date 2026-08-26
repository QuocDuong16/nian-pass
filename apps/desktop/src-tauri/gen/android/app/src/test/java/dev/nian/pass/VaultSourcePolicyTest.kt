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
}
