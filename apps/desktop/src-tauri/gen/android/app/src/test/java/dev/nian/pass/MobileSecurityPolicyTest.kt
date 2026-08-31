package dev.nian.pass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MobileSecurityPolicyTest {
  private fun safePolicy(): MobileSecurityPolicy = MobileSecurityPolicy { 50L }.apply {
    onProcessForegroundChanged(true)
    onActivityResumed(true)
    onWindowFocused(true)
  }

  @Test
  fun duplicateIdenticalTransitionsAreIdempotent() {
    val policy = MobileSecurityPolicy { 10L }
    assertEquals(0L, policy.snapshot().generation)
    assertEquals(1L, policy.onProcessForegroundChanged(true).generation)
    assertEquals(1L, policy.onProcessForegroundChanged(true).generation)
    assertEquals(2L, policy.onActivityResumed(true).generation)
    assertEquals(2L, policy.onActivityResumed(true).generation)
    assertEquals(3L, policy.onWindowFocused(true).generation)
    assertEquals(3L, policy.onWindowFocused(true).generation)
  }

  @Test
  fun pauseInvalidatesOldGenerationBeforeDelayedProcessStop() {
    val policy = safePolicy()
    val safeGeneration = policy.snapshot().generation
    val paused = policy.onActivityResumed(false)

    assertTrue(paused.foreground)
    assertFalse(paused.activityResumed)
    assertFalse(paused.windowFocused)
    assertTrue(paused.generation > safeGeneration)
    assertTrue(paused.curtainVisible)
    assertFalse(policy.acknowledgeSafeUi(safeGeneration))
  }

  @Test
  fun focusLossInvalidatesOldGenerationImmediately() {
    val policy = safePolicy()
    val safeGeneration = policy.snapshot().generation
    val unfocused = policy.onWindowFocused(false)

    assertTrue(unfocused.generation > safeGeneration)
    assertTrue(unfocused.curtainVisible)
    assertFalse(policy.acknowledgeSafeUi(safeGeneration))
    val focused = policy.onWindowFocused(true)
    assertFalse(policy.acknowledgeSafeUi(unfocused.generation))
    assertTrue(policy.acknowledgeSafeUi(focused.generation))
  }

  @Test
  fun processStopInvalidatesGenerationAndAcknowledgement() {
    val policy = safePolicy()
    val safeGeneration = policy.snapshot().generation
    val stopped = policy.onProcessForegroundChanged(false)

    assertTrue(stopped.generation > safeGeneration)
    assertTrue(stopped.curtainVisible)
    assertFalse(policy.acknowledgeSafeUi(stopped.generation))
  }

  @Test
  fun screenOffAndDeviceLockInvalidateGeneration() {
    val policy = safePolicy()
    val safeGeneration = policy.snapshot().generation
    val screenOff = policy.onScreenStateChanged(MobileScreenState.SCREEN_OFF)
    assertTrue(screenOff.generation > safeGeneration)
    assertFalse(policy.acknowledgeSafeUi(screenOff.generation))

    val locked = policy.onScreenStateChanged(MobileScreenState.DEVICE_LOCKED)
    assertTrue(locked.generation > screenOff.generation)
    assertFalse(policy.acknowledgeSafeUi(locked.generation))
  }

  @Test
  fun resumeWithoutFocusCannotAcknowledge() {
    val policy = safePolicy()
    policy.onActivityResumed(false)
    val resumed = policy.onActivityResumed(true)

    assertTrue(resumed.activityResumed)
    assertFalse(resumed.windowFocused)
    assertFalse(policy.acknowledgeSafeUi(resumed.generation))
  }

  @Test
  fun focusWithoutResumedCannotAcknowledge() {
    val policy = MobileSecurityPolicy { 50L }
    policy.onProcessForegroundChanged(true)
    val focused = policy.onWindowFocused(true)

    assertFalse(focused.activityResumed)
    assertFalse(focused.windowFocused)
    assertFalse(policy.acknowledgeSafeUi(focused.generation))
  }

  @Test
  fun processBackgroundCannotAcknowledge() {
    val policy = safePolicy()
    val background = policy.onProcessForegroundChanged(false)
    assertFalse(policy.acknowledgeSafeUi(background.generation))
  }

  @Test
  fun onlyCurrentFullySafeGenerationMayAcknowledge() {
    val policy = safePolicy()
    val current = policy.snapshot()

    assertFalse(policy.acknowledgeSafeUi(current.generation - 1))
    assertTrue(policy.acknowledgeSafeUi(current.generation))
    assertFalse(policy.snapshot().curtainVisible)
  }

  @Test
  fun screenClassifierPrioritizesInteractiveStateBeforeKeyguard() {
    assertEquals(
      MobileScreenState.SCREEN_OFF,
      classifyMobileScreenState(interactive = false, deviceLocked = false),
    )
    assertEquals(
      MobileScreenState.SCREEN_OFF,
      classifyMobileScreenState(interactive = false, deviceLocked = true),
    )
    assertEquals(
      MobileScreenState.DEVICE_LOCKED,
      classifyMobileScreenState(interactive = true, deviceLocked = true),
    )
    assertEquals(
      MobileScreenState.ACTIVE,
      classifyMobileScreenState(interactive = true, deviceLocked = false),
    )
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
