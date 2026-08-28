package dev.nian.pass

import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.widget.RemoteViews

class NianAutofillService : AutofillService() {
  override fun onFillRequest(
    request: FillRequest,
    cancellationSignal: CancellationSignal,
    callback: FillCallback,
  ) {
    val structure = request.fillContexts.lastOrNull()?.structure
    if (structure == null) {
      callback.onSuccess(null)
      return
    }
    val parsed = AssistStructureParser.parse(structure)
    val packageName = structure.activityComponent?.packageName
    val signingIdentity = packageName?.let { PackageSigningIdentity.fromPackage(this, it) }
    if (parsed == null || packageName == null || signingIdentity == null) {
      callback.onSuccess(null)
      return
    }
    val target = if (parsed.webDomain == null) {
      CredentialTarget(TargetKind.APP, packageName, signingIdentity)
    } else {
      CredentialTarget(TargetKind.WEB, packageName, signingIdentity, parsed.webDomain)
    }
    val token = AutofillRuntime.registry.registerAutofill(target, parsed.fields)
    cancellationSignal.setOnCancelListener { AutofillRuntime.registry.cancel(token) }
    val ids = (parsed.fields.usernameIds + parsed.fields.passwordIds).distinct().toTypedArray()
    val presentation = RemoteViews(this.packageName, android.R.layout.simple_list_item_1).apply {
      setTextViewText(android.R.id.text1, "Unlock Nian Pass for ${target.display()}")
    }
    val response = FillResponse.Builder()
      .setAuthentication(
        ids,
        AutofillIntents.credentialActivity(this, token).intentSender,
        presentation,
      )
      .build()
    callback.onSuccess(response)
  }

  /** M5.3 is retrieval-only: no SaveInfo is emitted and no KDBX mutation occurs. */
  override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
    callback.onSuccess()
  }
}
