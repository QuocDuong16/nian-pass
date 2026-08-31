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

internal data class ActivitySecurityState(
  var activityResumed: Boolean = false,
  var windowFocused: Boolean = false,
  var generation: Long,
  var curtainRequired: Boolean = true,
)

/** Pure Activity-scoped authority policy. Android UI ownership stays in MobileSecurityRuntime. */
internal class MobileSecurityPolicy<K : Any>(
  private val clock: () -> Long,
  private val activities: MutableMap<K, ActivitySecurityState> = mutableMapOf(),
) {
  private var processForeground = false
  private var screenState = MobileScreenState.ACTIVE
  private var generationSequence = 0L
  private var generationExhausted = false

  @Synchronized
  fun attach(activity: K): MobileSecuritySnapshot {
    activities[activity]?.let { return snapshot(it) }
    val state = ActivitySecurityState(generation = nextGeneration())
    activities[activity] = state
    return snapshot(state)
  }

  @Synchronized
  fun detach(activity: K): Boolean = activities.remove(activity) != null

  @Synchronized
  fun onProcessForegroundChanged(foreground: Boolean): Boolean {
    if (processForeground == foreground) return false
    processForeground = foreground
    invalidateAllActivities()
    return true
  }

  @Synchronized
  fun onActivityResumed(activity: K, resumed: Boolean): MobileSecuritySnapshot? {
    val state = activities[activity] ?: return null
    val changed = state.activityResumed != resumed || (!resumed && state.windowFocused)
    state.activityResumed = resumed
    if (!resumed) state.windowFocused = false
    finishActivityTransition(state, changed)
    return snapshot(state)
  }

  @Synchronized
  fun onWindowFocused(activity: K, focused: Boolean): MobileSecuritySnapshot? {
    val state = activities[activity] ?: return null
    val acceptedFocus = focused && state.activityResumed
    val changed = state.windowFocused != acceptedFocus
    state.windowFocused = acceptedFocus
    finishActivityTransition(state, changed)
    return snapshot(state)
  }

  @Synchronized
  fun onScreenStateChanged(next: MobileScreenState): Boolean {
    if (screenState == next) return false
    screenState = next
    invalidateAllActivities()
    return true
  }

  @Synchronized
  fun acknowledgeSafeUi(activity: K, expectedGeneration: Long): Boolean {
    val state = activities[activity] ?: return false
    if (
      generationExhausted ||
      expectedGeneration != state.generation ||
      !acknowledgementEligible(state)
    ) {
      state.curtainRequired = true
      return false
    }
    state.curtainRequired = false
    return true
  }

  @Synchronized
  fun snapshot(activity: K): MobileSecuritySnapshot? =
    activities[activity]?.let(::snapshot)

  @Synchronized
  fun detachedSnapshot(): MobileSecuritySnapshot = MobileSecuritySnapshot(
    foreground = processForeground,
    activityResumed = false,
    windowFocused = false,
    elapsedRealtimeMs = clock(),
    generation = generationSequence,
    screenState = screenState,
    curtainVisible = true,
  )

  private fun finishActivityTransition(state: ActivitySecurityState, changed: Boolean) {
    if (changed) {
      state.generation = nextGeneration()
      state.curtainRequired = true
    }
    if (!acknowledgementEligible(state)) state.curtainRequired = true
  }

  private fun invalidateAllActivities() {
    activities.values.forEach { state ->
      state.generation = nextGeneration()
      state.curtainRequired = true
    }
  }

  private fun nextGeneration(): Long {
    if (generationSequence >= MAX_SAFE_GENERATION) {
      generationExhausted = true
      return MAX_SAFE_GENERATION
    }
    generationSequence += 1
    return generationSequence
  }

  private fun acknowledgementEligible(state: ActivitySecurityState): Boolean =
    state.activityResumed &&
      state.windowFocused &&
      processForeground &&
      screenState == MobileScreenState.ACTIVE

  private fun snapshot(state: ActivitySecurityState): MobileSecuritySnapshot =
    MobileSecuritySnapshot(
      foreground = processForeground,
      activityResumed = state.activityResumed,
      windowFocused = state.windowFocused,
      elapsedRealtimeMs = clock(),
      generation = state.generation,
      screenState = screenState,
      curtainVisible = state.curtainRequired,
    )

  private companion object {
    const val MAX_SAFE_GENERATION = 9_007_199_254_740_991L
  }
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
