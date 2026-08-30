package dev.nian.pass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MobileSecurityPolicyTest {
  @Test
  fun lifecycleGenerationIsMonotonicAndDuplicateTransitionsAreIdempotent() {
    var now = 10L
    val policy = MobileSecurityPolicy { now }

    assertEquals(0L, policy.snapshot().generation)
    assertEquals(1L, policy.onForeground().generation)
    assertEquals(1L, policy.onForeground().generation)
    assertTrue(policy.acknowledgeSafeUi(1L))
    assertFalse(policy.snapshot().curtainVisible)

    now = 20L
    assertEquals(2L, policy.onBackground().generation)
    assertEquals(2L, policy.onBackground().generation)
    assertTrue(policy.snapshot().curtainVisible)
    assertEquals(20L, policy.snapshot().elapsedRealtimeMs)
  }

  @Test
  fun staleAcknowledgementAndScreenOffStayFailClosed() {
    val policy = MobileSecurityPolicy { 50L }
    policy.onForeground()
    assertEquals(2L, policy.onScreenStateChanged(MobileScreenState.SCREEN_OFF).generation)
    assertFalse(policy.acknowledgeSafeUi(1L))
    assertFalse(policy.acknowledgeSafeUi(2L))
    assertEquals(MobileScreenState.SCREEN_OFF, policy.snapshot().screenState)

    assertEquals(3L, policy.onScreenStateChanged(MobileScreenState.DEVICE_LOCKED).generation)
    assertEquals(4L, policy.onScreenStateChanged(MobileScreenState.ACTIVE).generation)
    assertTrue(policy.acknowledgeSafeUi(4L))
  }

  @Test
  fun curtainAndApiPoliciesAreIdempotent() {
    val curtain = CurtainAttachmentModel()
    curtain.show()
    curtain.show()
    curtain.show()
    assertEquals(1, curtain.attachedCount)
    curtain.hide()
    curtain.hide()
    assertEquals(0, curtain.attachedCount)

    assertFalse(RecentsProtectionPolicy.shouldDisableScreenshots(32))
    assertTrue(RecentsProtectionPolicy.shouldDisableScreenshots(33))
  }
}
