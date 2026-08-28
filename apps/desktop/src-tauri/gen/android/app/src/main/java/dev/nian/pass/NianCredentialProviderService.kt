package dev.nian.pass

import android.os.CancellationSignal
import android.os.OutcomeReceiver
import androidx.annotation.RequiresApi
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.CreateCredentialNoCreateOptionException
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import androidx.credentials.provider.AuthenticationAction
import androidx.credentials.provider.BeginCreateCredentialRequest
import androidx.credentials.provider.BeginCreateCredentialResponse
import androidx.credentials.provider.BeginGetCredentialRequest
import androidx.credentials.provider.BeginGetCredentialResponse
import androidx.credentials.provider.BeginGetPasswordOption
import androidx.credentials.provider.CredentialProviderService
import androidx.credentials.provider.ProviderClearCredentialStateRequest

@RequiresApi(34)
class NianCredentialProviderService : CredentialProviderService() {
  override fun onBeginGetCredentialRequest(
    request: BeginGetCredentialRequest,
    cancellationSignal: CancellationSignal,
    callback: OutcomeReceiver<BeginGetCredentialResponse, GetCredentialException>,
  ) {
    val option = request.beginGetCredentialOptions.filterIsInstance<BeginGetPasswordOption>().firstOrNull()
    val caller = request.callingAppInfo
    val target = caller?.let { CredentialTargetClassifier.fromCallingApp(this, it) }
    if (option == null || target == null) {
      callback.onError(NoCredentialException("credential_unavailable"))
      return
    }
    val token = AutofillRuntime.registry.registerCredential(target, option)
    cancellationSignal.setOnCancelListener { AutofillRuntime.registry.cancel(token) }
    val action = AuthenticationAction.Builder(
      "Unlock or choose from Nian Pass",
      AutofillIntents.credentialActivity(this, token),
    ).build()
    callback.onResult(
      BeginGetCredentialResponse.Builder()
        .addAuthenticationAction(action)
        .build(),
    )
  }

  override fun onBeginCreateCredentialRequest(
    request: BeginCreateCredentialRequest,
    cancellationSignal: CancellationSignal,
    callback: OutcomeReceiver<BeginCreateCredentialResponse, CreateCredentialException>,
  ) {
    callback.onError(CreateCredentialNoCreateOptionException("create_not_supported"))
  }

  override fun onClearCredentialStateRequest(
    request: ProviderClearCredentialStateRequest,
    cancellationSignal: CancellationSignal,
    callback: OutcomeReceiver<Void?, ClearCredentialException>,
  ) {
    AutofillRuntime.registry.clear()
    callback.onResult(null)
  }
}
