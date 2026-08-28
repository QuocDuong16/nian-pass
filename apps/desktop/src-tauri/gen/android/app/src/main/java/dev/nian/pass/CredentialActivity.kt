package dev.nian.pass

import android.os.Bundle
import android.view.WindowManager

/** Narrow Tauri host used only for Android credential authentication/results. */
class CredentialActivity : MainActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    super.onCreate(savedInstanceState)
    AutofillRuntime.activeCredentialActivity = this
  }

  override fun onResume() {
    super.onResume()
    AutofillRuntime.activeCredentialActivity = this
  }

  override fun onPause() {
    window.decorView.alpha = 0f
    super.onPause()
  }

  override fun onPostResume() {
    super.onPostResume()
    window.decorView.alpha = 1f
  }

  override fun onDestroy() {
    if (AutofillRuntime.activeCredentialActivity === this) {
      AutofillRuntime.activeCredentialActivity = null
    }
    super.onDestroy()
  }
}
