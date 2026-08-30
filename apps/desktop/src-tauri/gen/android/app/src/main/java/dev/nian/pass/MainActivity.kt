package dev.nian.pass

import android.os.Bundle
import androidx.activity.enableEdgeToEdge

open class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    MobileSecurityRuntime.configureSecureWindow(this)
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    MobileSecurityRuntime.attach(this)
  }

  override fun onResume() {
    super.onResume()
    MobileSecurityRuntime.onResume(this)
  }

  override fun onPause() {
    MobileSecurityRuntime.onPause()
    super.onPause()
  }

  override fun onWindowFocusChanged(hasFocus: Boolean) {
    if (!hasFocus) MobileSecurityRuntime.onWindowFocusChanged(this, false)
    super.onWindowFocusChanged(hasFocus)
    if (hasFocus) MobileSecurityRuntime.onWindowFocusChanged(this, true)
  }

  override fun onDestroy() {
    MobileSecurityRuntime.detach(this)
    super.onDestroy()
  }
}
