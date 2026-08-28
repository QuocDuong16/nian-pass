package dev.nian.pass

import android.content.Intent
import android.os.Bundle
import android.view.WindowManager

/** Narrow Tauri host used only for Android credential authentication/results. */
class CredentialActivity : MainActivity() {
  private val requestState = CredentialActivityRequestState()
  private var currentRequestToken: String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    super.onCreate(savedInstanceState)
    refreshRequest(intent)
    AutofillRuntime.activeCredentialActivity = this
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    refreshRequest(intent)
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

  internal fun consumeCurrentRequest() {
    requestState.consumeCurrent()
  }

  private fun refreshRequest(newIntent: Intent) {
    val priorToken = currentRequestToken
    if (!requestState.activate(newIntent.dataString)) {
      priorToken?.let(AutofillRuntime.registry::cancel)
      currentRequestToken = null
      clearCustomAuthority(newIntent)
      return
    }
    val reconstructed = CredentialRequestReconstructor.reconstruct(this, newIntent)
    if (reconstructed == null) {
      priorToken?.let(AutofillRuntime.registry::cancel)
      currentRequestToken = null
      clearCustomAuthority(newIntent)
      return
    }
    if (priorToken != null && priorToken != reconstructed) {
      AutofillRuntime.registry.cancel(priorToken)
    }
    currentRequestToken = reconstructed
  }

  private fun clearCustomAuthority(target: Intent) {
    target.removeExtra(AutofillIntents.EXTRA_REQUEST_TOKEN)
    target.removeExtra(AutofillIntents.EXTRA_CANDIDATE_TOKEN)
    target.removeExtra(AutofillIntents.EXTRA_SELECTED_ENTRY_ID)
  }
}
