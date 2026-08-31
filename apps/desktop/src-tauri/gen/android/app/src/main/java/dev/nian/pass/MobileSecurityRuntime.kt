package dev.nian.pass

import android.app.Activity
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Color
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.TextView
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import java.util.IdentityHashMap
import java.util.WeakHashMap

internal class PrivacyCurtainController(private val activity: Activity) {
  private var curtain: View? = null
  private val coveredAccessibility = IdentityHashMap<View, Int>()

  fun show() {
    if (curtain?.parent != null) return
    val content = activity.findViewById<ViewGroup>(android.R.id.content)
    for (index in 0 until content.childCount) {
      val child = content.getChildAt(index)
      coveredAccessibility[child] = child.importantForAccessibility
      child.importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    }
    val view = TextView(activity).apply {
      text = "Nian Pass"
      contentDescription = "Nian Pass locked"
      setTextColor(Color.WHITE)
      textSize = 24f
      gravity = Gravity.CENTER
      setBackgroundColor(Color.rgb(15, 20, 18))
      isClickable = true
      isFocusable = true
      importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
    }
    activity.addContentView(
      view,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )
    view.bringToFront()
    view.requestFocus()
    curtain = view
  }

  fun hide() {
    val view = curtain ?: return
    (view.parent as? ViewGroup)?.removeView(view)
    coveredAccessibility.forEach { (covered, importance) ->
      covered.importantForAccessibility = importance
    }
    coveredAccessibility.clear()
    curtain = null
  }

  fun isVisible(): Boolean = curtain?.parent != null
}

/** Native authority for secure-window setup, lifecycle generation, and the resume curtain. */
internal object MobileSecurityRuntime {
  private val policy = MobileSecurityPolicy(SystemClock::elapsedRealtime)
  private val curtains = WeakHashMap<Activity, PrivacyCurtainController>()
  private val receivers = WeakHashMap<Activity, BroadcastReceiver>()
  private var processObserverInstalled = false

  @Synchronized
  fun configureSecureWindow(activity: Activity) {
    activity.window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    if (RecentsProtectionPolicy.shouldDisableScreenshots(Build.VERSION.SDK_INT)) {
      activity.setRecentsScreenshotEnabled(false)
    }
  }

  @Synchronized
  fun attach(activity: Activity) {
    curtains.getOrPut(activity) { PrivacyCurtainController(activity) }.show()
    registerScreenReceiver(activity)
    refreshDeviceState(activity)
    installProcessObserver()
  }

  @Synchronized
  fun detach(activity: Activity) {
    receivers.remove(activity)?.let {
      try {
        activity.unregisterReceiver(it)
      } catch (_: IllegalArgumentException) {
        // Already detached by Android during Activity teardown.
      }
    }
    curtains.remove(activity)?.hide()
  }

  @Synchronized
  fun onResume(activity: Activity) {
    showAll()
    policy.onActivityResumed(true)
    refreshDeviceState(activity)
  }

  @Synchronized
  fun onPause() {
    policy.onActivityResumed(false)
    showAll()
  }

  @Synchronized
  fun onWindowFocusChanged(activity: Activity, hasFocus: Boolean) {
    policy.onWindowFocused(hasFocus)
    if (!hasFocus || policy.snapshot().curtainVisible) showAll()
    refreshDeviceState(activity)
  }

  @Synchronized
  fun status(activity: Activity): MobileSecuritySnapshot {
    refreshDeviceState(activity)
    val snapshot = policy.snapshot()
    return snapshot.copy(curtainVisible = curtains[activity]?.isVisible() == true)
  }

  @Synchronized
  fun acknowledgeSafeUi(activity: Activity, generation: Long): Boolean {
    refreshDeviceState(activity)
    if (!policy.acknowledgeSafeUi(generation)) {
      showAll()
      return false
    }
    curtains[activity]?.hide()
    return true
  }

  @Synchronized
  fun hasCurtain(activity: Activity): Boolean = curtains[activity]?.isVisible() == true

  private fun showAll() {
    curtains.values.forEach(PrivacyCurtainController::show)
  }

  private fun refreshDeviceState(activity: Activity) {
    val power = activity.getSystemService(Context.POWER_SERVICE) as PowerManager
    val keyguard = activity.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    val next = classifyMobileScreenState(power.isInteractive, keyguard.isDeviceLocked)
    val snapshot = policy.onScreenStateChanged(next)
    if (snapshot.curtainVisible) showAll()
  }

  private fun registerScreenReceiver(activity: Activity) {
    if (receivers.containsKey(activity)) return
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        synchronized(this@MobileSecurityRuntime) {
          when (intent?.action) {
            Intent.ACTION_SCREEN_OFF -> {
              showAll()
              refreshDeviceState(activity)
            }
            Intent.ACTION_SCREEN_ON -> {
              showAll()
              refreshDeviceState(activity)
            }
            Intent.ACTION_USER_PRESENT -> {
              showAll()
              refreshDeviceState(activity)
            }
          }
        }
      }
    }
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_SCREEN_OFF)
      addAction(Intent.ACTION_SCREEN_ON)
      addAction(Intent.ACTION_USER_PRESENT)
    }
    activity.registerReceiver(receiver, filter)
    receivers[activity] = receiver
  }

  private fun installProcessObserver() {
    if (processObserverInstalled) return
    processObserverInstalled = true
    ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
      override fun onStart(owner: LifecycleOwner) {
        synchronized(this@MobileSecurityRuntime) {
          val snapshot = policy.onProcessForegroundChanged(true)
          if (snapshot.curtainVisible) showAll()
        }
      }

      override fun onStop(owner: LifecycleOwner) {
        synchronized(this@MobileSecurityRuntime) {
          policy.onProcessForegroundChanged(false)
          showAll()
        }
      }
    })
  }
}
