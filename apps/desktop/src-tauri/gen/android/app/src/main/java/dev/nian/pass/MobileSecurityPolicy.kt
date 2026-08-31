package dev.nian.pass

internal enum class MobileScreenState { ACTIVE, SCREEN_OFF, DEVICE_LOCKED }

internal data class MobileSecuritySnapshot(
  val foreground: Boolean,
  val activityResumed: Boolean,
  val windowFocused: Boolean,
  val elapsedRealtimeMs: Long,
  val generation: Long,
  val screenState: MobileScreenState,
  val curtainVisible: Boolean,
)

/** Pure process-local lifecycle policy. Android UI ownership stays in MobileSecurityRuntime. */
internal class MobileSecurityPolicy(private val clock: () -> Long) {
  private var processForeground = false
  private var activityResumed = false
  private var windowFocused = false
  private var generation = 0L
  private var screenState = MobileScreenState.ACTIVE
  private var curtainRequired = true

  @Synchronized
  fun onProcessForegroundChanged(foreground: Boolean): MobileSecuritySnapshot {
    val changed = processForeground != foreground
    processForeground = foreground
    return finishAuthorityTransition(changed)
  }

  @Synchronized
  fun onActivityResumed(resumed: Boolean): MobileSecuritySnapshot {
    val changed = activityResumed != resumed || (!resumed && windowFocused)
    activityResumed = resumed
    if (!resumed) windowFocused = false
    return finishAuthorityTransition(changed)
  }

  @Synchronized
  fun onWindowFocused(focused: Boolean): MobileSecuritySnapshot {
    val acceptedFocus = focused && activityResumed
    val changed = windowFocused != acceptedFocus
    windowFocused = acceptedFocus
    return finishAuthorityTransition(changed)
  }

  @Synchronized
  fun onScreenStateChanged(next: MobileScreenState): MobileSecuritySnapshot {
    val changed = screenState != next
    screenState = next
    return finishAuthorityTransition(changed)
  }

  @Synchronized
  fun acknowledgeSafeUi(expectedGeneration: Long): Boolean {
    if (expectedGeneration != generation || !acknowledgementEligible()) return false
    curtainRequired = false
    return true
  }

  @Synchronized
  fun snapshot(): MobileSecuritySnapshot = MobileSecuritySnapshot(
    foreground = processForeground,
    activityResumed = activityResumed,
    windowFocused = windowFocused,
    elapsedRealtimeMs = clock(),
    generation = generation,
    screenState = screenState,
    curtainVisible = curtainRequired,
  )

  private fun finishAuthorityTransition(changed: Boolean): MobileSecuritySnapshot {
    if (changed) generation += 1
    if (!acknowledgementEligible()) curtainRequired = true
    return snapshot()
  }

  private fun acknowledgementEligible(): Boolean =
    activityResumed &&
      windowFocused &&
      processForeground &&
      screenState == MobileScreenState.ACTIVE
}

internal fun classifyMobileScreenState(
  interactive: Boolean,
  deviceLocked: Boolean,
): MobileScreenState = when {
  !interactive -> MobileScreenState.SCREEN_OFF
  deviceLocked -> MobileScreenState.DEVICE_LOCKED
  else -> MobileScreenState.ACTIVE
}

internal object RecentsProtectionPolicy {
  fun shouldDisableScreenshots(apiLevel: Int): Boolean = apiLevel >= 33
}

/** Testable model for the idempotent one-curtain-per-Activity invariant. */
internal class CurtainAttachmentModel {
  var attachedCount: Int = 0
    private set

  fun show() {
    attachedCount = 1
  }

  fun hide() {
    attachedCount = 0
  }
}
