package dev.nian.pass

import android.content.Intent
import android.os.Bundle

/** Narrow Tauri host used only for Android credential authentication/results. */
class CredentialActivity : MainActivity() {
  private val requestState = CredentialActivityRequestState()
  private val completion = CredentialCompletionGate()

  override fun onCreate(savedInstanceState: Bundle?) {
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
    super.onPause()
    retireForBackground()
  }

  override fun onDestroy() {
    retireForBackground()
    if (AutofillRuntime.activeCredentialActivity === this) {
      AutofillRuntime.activeCredentialActivity = null
    }
    super.onDestroy()
  }

  internal fun completeCurrentRequest(requestToken: String): Boolean {
    if (!completion.complete(requestToken)) return false
    requestState.consumeCurrent()
    return true
  }

  private fun refreshRequest(newIntent: Intent) {
    val priorToken = completion.currentToken
    if (!requestState.activate(newIntent.dataString)) {
      completion.retire()?.let(AutofillRuntime.registry::cancel)
      clearCustomAuthority(newIntent)
      return
    }
    val reconstructed = CredentialRequestReconstructor.reconstruct(this, newIntent)
    if (reconstructed == null) {
      completion.retire()?.let(AutofillRuntime.registry::cancel)
      requestState.consumeCurrent()
      clearCustomAuthority(newIntent)
      return
    }
    if (priorToken != null && priorToken != reconstructed) {
      AutofillRuntime.registry.cancel(priorToken)
    }
    completion.activate(reconstructed)
  }

  private fun retireForBackground() {
    val requestToken = completion.retire() ?: return
    AutofillRuntime.registry.cancel(requestToken)
    requestState.consumeCurrent()
    clearCustomAuthority(intent)
    setResult(RESULT_CANCELED)
    if (!isFinishing) finish()
  }

  private fun clearCustomAuthority(target: Intent) {
    target.removeExtra(AutofillIntents.EXTRA_REQUEST_TOKEN)
    target.removeExtra(AutofillIntents.EXTRA_CANDIDATE_TOKEN)
    target.removeExtra(AutofillIntents.EXTRA_SELECTED_ENTRY_ID)
  }
}

internal class CredentialCompletionGate {
  var currentToken: String? = null
    private set
  private var completed = true

  fun activate(requestToken: String) {
    currentToken = requestToken
    completed = false
  }

  fun complete(requestToken: String): Boolean {
    if (completed || currentToken != requestToken) return false
    completed = true
    currentToken = null
    return true
  }

  fun retire(): String? {
    val requestToken = currentToken ?: return null
    if (!complete(requestToken)) return null
    return requestToken
  }
}
