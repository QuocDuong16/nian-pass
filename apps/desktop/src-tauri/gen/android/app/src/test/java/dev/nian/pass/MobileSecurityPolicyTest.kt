package dev.nian.pass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MobileSecurityPolicyTest {
  private fun newPolicy(): MobileSecurityPolicy<String> =
    MobileSecurityPolicy(clock = { 50L })

  private fun safePolicy(activity: String = "A"): MobileSecurityPolicy<String> =
    newPolicy().apply {
      attach(activity)
      onProcessForegroundChanged(true)
      onActivityResumed(activity, true)
      onWindowFocused(activity, true)
    }

  @Test
  fun duplicateIdenticalTransitionsAreIdempotent() {
    val policy = newPolicy()
    assertEquals(1L, policy.attach("A").generation)
    assertEquals(1L, policy.attach("A").generation)
    assertTrue(policy.onProcessForegroundChanged(true))
    assertFalse(policy.onProcessForegroundChanged(true))
    assertEquals(2L, policy.snapshot("A")?.generation)
    assertEquals(3L, policy.onActivityResumed("A", true)?.generation)
    assertEquals(3L, policy.onActivityResumed("A", true)?.generation)
    assertEquals(4L, policy.onWindowFocused("A", true)?.generation)
    assertEquals(4L, policy.onWindowFocused("A", true)?.generation)
  }

  @Test
  fun pauseInvalidatesOldGenerationBeforeDelayedProcessStop() {
    val policy = safePolicy()
    val safeGeneration = policy.snapshot("A")!!.generation
    val paused = policy.onActivityResumed("A", false)!!

    assertTrue(paused.foreground)
    assertFalse(paused.activityResumed)
    assertFalse(paused.windowFocused)
    assertTrue(paused.generation > safeGeneration)
    assertTrue(paused.curtainVisible)
    assertFalse(policy.acknowledgeSafeUi("A", safeGeneration))
  }

  @Test
  fun focusLossInvalidatesOldGenerationImmediately() {
    val policy = safePolicy()
    val safeGeneration = policy.snapshot("A")!!.generation
    val unfocused = policy.onWindowFocused("A", false)!!

    assertTrue(unfocused.generation > safeGeneration)
    assertTrue(unfocused.curtainVisible)
    assertFalse(policy.acknowledgeSafeUi("A", safeGeneration))
    val focused = policy.onWindowFocused("A", true)!!
    assertFalse(policy.acknowledgeSafeUi("A", unfocused.generation))
    assertTrue(policy.acknowledgeSafeUi("A", focused.generation))
  }

  @Test
  fun processStopInvalidatesGenerationAndAcknowledgement() {
    val policy = safePolicy()
    val safeGeneration = policy.snapshot("A")!!.generation
    assertTrue(policy.onProcessForegroundChanged(false))
    val stopped = policy.snapshot("A")!!

    assertTrue(stopped.generation > safeGeneration)
    assertTrue(stopped.curtainVisible)
    assertFalse(policy.acknowledgeSafeUi("A", stopped.generation))
  }

  @Test
  fun screenOffAndDeviceLockInvalidateGeneration() {
    val policy = safePolicy()
    val safeGeneration = policy.snapshot("A")!!.generation
    assertTrue(policy.onScreenStateChanged(MobileScreenState.SCREEN_OFF))
    val screenOff = policy.snapshot("A")!!
    assertTrue(screenOff.generation > safeGeneration)
    assertFalse(policy.acknowledgeSafeUi("A", screenOff.generation))

    assertTrue(policy.onScreenStateChanged(MobileScreenState.DEVICE_LOCKED))
    val locked = policy.snapshot("A")!!
    assertTrue(locked.generation > screenOff.generation)
    assertFalse(policy.acknowledgeSafeUi("A", locked.generation))
  }

  @Test
  fun resumeWithoutFocusCannotAcknowledge() {
    val policy = safePolicy()
    policy.onActivityResumed("A", false)
    val resumed = policy.onActivityResumed("A", true)!!

    assertTrue(resumed.activityResumed)
    assertFalse(resumed.windowFocused)
    assertFalse(policy.acknowledgeSafeUi("A", resumed.generation))
  }

  @Test
  fun focusWithoutResumedCannotAcknowledge() {
    val policy = newPolicy()
    policy.attach("A")
    policy.onProcessForegroundChanged(true)
    val focused = policy.onWindowFocused("A", true)!!

    assertFalse(focused.activityResumed)
    assertFalse(focused.windowFocused)
    assertFalse(policy.acknowledgeSafeUi("A", focused.generation))
  }

  @Test
  fun processBackgroundCannotAcknowledge() {
    val policy = safePolicy()
    policy.onProcessForegroundChanged(false)
    val background = policy.snapshot("A")!!
    assertFalse(policy.acknowledgeSafeUi("A", background.generation))
  }

  @Test
  fun onlyCurrentFullySafeGenerationMayAcknowledge() {
    val policy = safePolicy()
    val current = policy.snapshot("A")!!

    assertFalse(policy.acknowledgeSafeUi("A", current.generation - 1))
    assertTrue(policy.acknowledgeSafeUi("A", current.generation))
    assertFalse(policy.snapshot("A")!!.curtainVisible)
  }

  @Test
  fun activityAStateCannotAuthorizeActivityB() {
    val policy = newPolicy()
    policy.attach("A")
    policy.attach("B")
    policy.onProcessForegroundChanged(true)
    policy.onActivityResumed("A", true)
    val activityA = policy.onWindowFocused("A", true)!!
    val activityB = policy.snapshot("B")!!

    assertTrue(policy.acknowledgeSafeUi("A", activityA.generation))
    assertFalse(policy.acknowledgeSafeUi("B", activityB.generation))
    assertFalse(activityB.activityResumed)
    assertFalse(activityB.windowFocused)
  }

  @Test
  fun activityBStateCannotAuthorizePausedActivityA() {
    val policy = safePolicy()
    policy.attach("B")
    val pausedA = policy.onActivityResumed("A", false)!!
    policy.onActivityResumed("B", true)
    val focusedB = policy.onWindowFocused("B", true)!!

    assertFalse(policy.acknowledgeSafeUi("A", pausedA.generation))
    assertTrue(policy.acknowledgeSafeUi("B", focusedB.generation))
  }

  @Test
  fun staleFocusCallbackFromADoesNotInvalidateFocusedB() {
    val policy = safePolicy()
    policy.attach("B")
    policy.onActivityResumed("B", true)
    val focusedB = policy.onWindowFocused("B", true)!!

    policy.onWindowFocused("A", false)

    val unchangedB = policy.snapshot("B")!!
    assertEquals(focusedB.generation, unchangedB.generation)
    assertTrue(unchangedB.activityResumed)
    assertTrue(unchangedB.windowFocused)
    assertTrue(policy.acknowledgeSafeUi("B", focusedB.generation))
  }

  @Test
  fun globalBackgroundInvalidatesAllActivities() {
    val policy = safePolicy()
    policy.attach("B")
    policy.onActivityResumed("B", true)
    policy.onWindowFocused("B", true)
    val oldA = policy.snapshot("A")!!.generation
    val oldB = policy.snapshot("B")!!.generation

    policy.onProcessForegroundChanged(false)

    val backgroundA = policy.snapshot("A")!!
    val backgroundB = policy.snapshot("B")!!
    assertNotEquals(oldA, backgroundA.generation)
    assertNotEquals(oldB, backgroundB.generation)
    assertTrue(backgroundA.curtainVisible)
    assertTrue(backgroundB.curtainVisible)
    assertFalse(policy.acknowledgeSafeUi("A", oldA))
    assertFalse(policy.acknowledgeSafeUi("B", oldB))
  }

  @Test
  fun screenOffInvalidatesAllActivities() {
    val policy = safePolicy()
    policy.attach("B")
    val oldA = policy.snapshot("A")!!.generation
    val oldB = policy.snapshot("B")!!.generation

    policy.onScreenStateChanged(MobileScreenState.SCREEN_OFF)

    val screenOffA = policy.snapshot("A")!!
    val screenOffB = policy.snapshot("B")!!
    assertNotEquals(oldA, screenOffA.generation)
    assertNotEquals(oldB, screenOffB.generation)
    assertTrue(screenOffA.curtainVisible)
    assertTrue(screenOffB.curtainVisible)
    assertFalse(policy.acknowledgeSafeUi("A", oldA))
    assertFalse(policy.acknowledgeSafeUi("B", oldB))
  }

  @Test
  fun duplicateGlobalTransitionIsIdempotent() {
    val policy = safePolicy()
    policy.attach("B")
    assertTrue(policy.onProcessForegroundChanged(false))
    val backgroundA = policy.snapshot("A")!!.generation
    val backgroundB = policy.snapshot("B")!!.generation

    assertFalse(policy.onProcessForegroundChanged(false))
    assertEquals(backgroundA, policy.snapshot("A")!!.generation)
    assertEquals(backgroundB, policy.snapshot("B")!!.generation)
    assertTrue(policy.onScreenStateChanged(MobileScreenState.SCREEN_OFF))
    val screenOffA = policy.snapshot("A")!!.generation
    val screenOffB = policy.snapshot("B")!!.generation
    assertFalse(policy.onScreenStateChanged(MobileScreenState.SCREEN_OFF))
    assertEquals(screenOffA, policy.snapshot("A")!!.generation)
    assertEquals(screenOffB, policy.snapshot("B")!!.generation)
  }

  @Test
  fun detachedActivityCannotAcknowledge() {
    val policy = safePolicy()
    val oldGeneration = policy.snapshot("A")!!.generation

    assertTrue(policy.detach("A"))
    assertNull(policy.snapshot("A"))
    assertFalse(policy.acknowledgeSafeUi("A", oldGeneration))
    assertFalse(policy.detach("A"))
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
