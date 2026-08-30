package dev.nian.pass

internal enum class MobileScreenState { ACTIVE, SCREEN_OFF, DEVICE_LOCKED }

internal data class MobileSecuritySnapshot(
  val foreground: Boolean,
  val elapsedRealtimeMs: Long,
  val generation: Long,
  val screenState: MobileScreenState,
  val curtainVisible: Boolean,
)

/** Pure process-local lifecycle policy. Android UI ownership stays in MobileSecurityRuntime. */
internal class MobileSecurityPolicy(private val clock: () -> Long) {
  private var foreground = false
  private var generation = 0L
  private var screenState = MobileScreenState.ACTIVE
  private var curtainVisible = true

  @Synchronized
  fun onForeground(): MobileSecuritySnapshot {
    if (!foreground) {
      foreground = true
      generation += 1
    }
    return snapshot()
  }

  @Synchronized
  fun onBackground(): MobileSecuritySnapshot {
    if (foreground) {
      foreground = false
      generation += 1
    }
    curtainVisible = true
    return snapshot()
  }

  @Synchronized
  fun onScreenStateChanged(next: MobileScreenState): MobileSecuritySnapshot {
    if (screenState != next) {
      screenState = next
      generation += 1
    }
    if (next != MobileScreenState.ACTIVE) curtainVisible = true
    return snapshot()
  }

  @Synchronized
  fun acknowledgeSafeUi(expectedGeneration: Long): Boolean {
    if (
      expectedGeneration != generation ||
      !foreground ||
      screenState != MobileScreenState.ACTIVE
    ) return false
    curtainVisible = false
    return true
  }

  @Synchronized
  fun snapshot(): MobileSecuritySnapshot = MobileSecuritySnapshot(
    foreground = foreground,
    elapsedRealtimeMs = clock(),
    generation = generation,
    screenState = screenState,
    curtainVisible = curtainVisible,
  )

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
