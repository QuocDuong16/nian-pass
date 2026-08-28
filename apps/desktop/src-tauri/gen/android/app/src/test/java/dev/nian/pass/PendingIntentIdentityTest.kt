package dev.nian.pass

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.SecureRandom

class PendingIntentIdentityTest {
  @Test
  fun identityIsOpaqueUnpredictableAndContainsNoRequestData() {
    val first = PendingIntentIdentity.newDataUri(SecureRandom())
    val second = PendingIntentIdentity.newDataUri(SecureRandom())
    assertTrue(PendingIntentIdentity.isValid(first))
    assertTrue(PendingIntentIdentity.isValid(second))
    assertNotEquals(first, second)
    assertFalse(first.contains("content://"))
    assertFalse(first.contains("example.com"))
  }

  @Test
  fun simulatedRuntimeRecreationCannotAliasPriorPendingIntent() {
    val beforeRestart = PendingIntentIdentity.newDataUri(SecureRandom())
    val afterRestart = PendingIntentIdentity.newDataUri(SecureRandom())
    assertNotEquals(beforeRestart, afterRestart)
    assertFalse(PendingIntentIdentity.isValid("nianpass://credential/sequential-1"))
  }
}
