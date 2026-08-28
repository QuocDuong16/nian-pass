package dev.nian.pass

import android.app.assist.AssistStructure
import android.content.Context
import android.content.Intent
import android.os.Build
import android.view.autofill.AutofillManager
import androidx.credentials.GetPasswordOption
import androidx.credentials.provider.BeginGetPasswordOption
import androidx.credentials.provider.PendingIntentHandler

internal enum class FrameworkRequestKind { CREDENTIAL_AUTH, CREDENTIAL_FINAL, AUTOFILL_AUTH }

internal data class FrameworkRequestAuthority(
  val kind: FrameworkRequestKind,
  val target: CredentialTarget,
  val selectedEntryId: String? = null,
  val fieldCount: Int = 0,
)

internal enum class ReconstructionDisposition { CREATE_FRESH, REUSE_CACHED, REJECT }

internal object RequestReconstructionPolicy {
  fun isRecoverable(authority: FrameworkRequestAuthority?): Boolean = when (authority?.kind) {
    FrameworkRequestKind.CREDENTIAL_AUTH -> authority.selectedEntryId == null
    FrameworkRequestKind.CREDENTIAL_FINAL -> !authority.selectedEntryId.isNullOrEmpty()
    FrameworkRequestKind.AUTOFILL_AUTH -> authority.fieldCount > 0
    null -> false
  }

  fun reconcile(
    authority: FrameworkRequestAuthority?,
    cachedKind: FrameworkRequestKind?,
    cachedTarget: CredentialTarget?,
    cachedSelectedEntryId: String? = null,
  ): ReconstructionDisposition {
    if (!isRecoverable(authority)) return ReconstructionDisposition.REJECT
    authority ?: return ReconstructionDisposition.REJECT
    if (cachedKind == null && cachedTarget == null) return ReconstructionDisposition.CREATE_FRESH
    if (cachedKind != authority.kind || cachedTarget != authority.target) {
      return ReconstructionDisposition.REJECT
    }
    if (
      authority.kind == FrameworkRequestKind.CREDENTIAL_FINAL &&
      cachedSelectedEntryId != authority.selectedEntryId
    ) return ReconstructionDisposition.REJECT
    return ReconstructionDisposition.REUSE_CACHED
  }
}

internal class CredentialActivityRequestState(
  private val uses: PendingIntentUseRegistry = AutofillRuntime.pendingIntentUses,
) {
  var currentIdentity: String? = null
    private set

  fun activate(identity: String?): Boolean {
    if (!PendingIntentIdentity.isValid(identity) || identity == null || uses.isRetired(identity)) {
      return false
    }
    currentIdentity?.takeIf { it != identity }?.let(uses::retire)
    currentIdentity = identity
    return true
  }

  fun consumeCurrent() {
    currentIdentity?.let(uses::retire)
  }
}

internal object CredentialRequestReconstructor {
  fun reconstruct(context: Context, intent: Intent): String? {
    if (!PendingIntentIdentity.isValid(intent.dataString)) return null
    val oldRequestToken = intent.getStringExtra(AutofillIntents.EXTRA_REQUEST_TOKEN)
      ?.takeIf(AutofillRuntime.registry::isOpaqueToken) ?: return null

    extractCredentialFinal(context, intent)?.let { (authority, _) ->
      if (!RequestReconstructionPolicy.isRecoverable(authority)) return null
      val selectedEntryId = authority.selectedEntryId ?: return null
      val oldCandidateToken = intent.getStringExtra(AutofillIntents.EXTRA_CANDIDATE_TOKEN)
        ?.takeIf(AutofillRuntime.registry::isOpaqueToken) ?: return null
      val cached = AutofillRuntime.registry.request(oldRequestToken)
      val cachedCandidate = oldCandidateToken.let {
        AutofillRuntime.registry.candidate(it, oldRequestToken)
      }
      val requestToken: String
      val candidateToken: String
      when (RequestReconstructionPolicy.reconcile(
        authority,
        cachedKind = cached?.let { FrameworkRequestKind.CREDENTIAL_FINAL },
        cachedTarget = cached?.target,
        cachedSelectedEntryId = cachedCandidate?.entryId,
      )) {
        ReconstructionDisposition.CREATE_FRESH -> {
          requestToken = AutofillRuntime.registry.registerCredentialFulfillment(authority.target)
          candidateToken = AutofillRuntime.registry.registerCandidate(requestToken, selectedEntryId)
        }
        ReconstructionDisposition.REUSE_CACHED -> {
          if (cached !is AndroidRequestRecord.Credential || cachedCandidate == null) return null
          requestToken = oldRequestToken
          candidateToken = oldCandidateToken
        }
        ReconstructionDisposition.REJECT -> return null
      }
      updateTokens(intent, requestToken, candidateToken, selectedEntryId)
      return requestToken
    }

    extractCredentialAuth(context, intent)?.let { (authority, option) ->
      if (!RequestReconstructionPolicy.isRecoverable(authority)) return null
      val cached = AutofillRuntime.registry.request(oldRequestToken)
      val requestToken = when (RequestReconstructionPolicy.reconcile(
        authority,
        cachedKind = cached?.let { FrameworkRequestKind.CREDENTIAL_AUTH },
        cachedTarget = cached?.target,
      )) {
        ReconstructionDisposition.CREATE_FRESH ->
          AutofillRuntime.registry.registerCredential(authority.target, option)
        ReconstructionDisposition.REUSE_CACHED -> {
          if (cached !is AndroidRequestRecord.Credential || cached.option?.id != option.id) return null
          oldRequestToken
        }
        ReconstructionDisposition.REJECT -> return null
      }
      updateTokens(intent, requestToken)
      return requestToken
    }

    extractAutofill(context, intent)?.let { (authority, fields) ->
      if (!RequestReconstructionPolicy.isRecoverable(authority)) return null
      val cached = AutofillRuntime.registry.request(oldRequestToken)
      val requestToken = when (RequestReconstructionPolicy.reconcile(
        authority,
        cachedKind = cached?.let { FrameworkRequestKind.AUTOFILL_AUTH },
        cachedTarget = cached?.target,
      )) {
        ReconstructionDisposition.CREATE_FRESH ->
          AutofillRuntime.registry.registerAutofill(authority.target, fields)
        ReconstructionDisposition.REUSE_CACHED -> {
          if (cached !is AndroidRequestRecord.Autofill || cached.fields != fields) return null
          oldRequestToken
        }
        ReconstructionDisposition.REJECT -> return null
      }
      updateTokens(intent, requestToken)
      return requestToken
    }
    return null
  }

  private fun extractCredentialAuth(
    context: Context,
    intent: Intent,
  ): Pair<FrameworkRequestAuthority, BeginGetPasswordOption>? {
    if (Build.VERSION.SDK_INT < 34) return null
    val request = try {
      PendingIntentHandler.retrieveBeginGetCredentialRequest(intent)
    } catch (_: Exception) {
      null
    } ?: return null
    val option = request.beginGetCredentialOptions.filterIsInstance<BeginGetPasswordOption>()
      .singleOrNull() ?: return null
    val caller = request.callingAppInfo ?: return null
    val target = CredentialTargetClassifier.fromCallingApp(context, caller) ?: return null
    return FrameworkRequestAuthority(FrameworkRequestKind.CREDENTIAL_AUTH, target) to option
  }

  private fun extractCredentialFinal(
    context: Context,
    intent: Intent,
  ): Pair<FrameworkRequestAuthority, GetPasswordOption>? {
    if (Build.VERSION.SDK_INT < 34) return null
    val request = try {
      PendingIntentHandler.retrieveProviderGetCredentialRequest(intent)
    } catch (_: Exception) {
      null
    } ?: return null
    val option = request.credentialOptions.filterIsInstance<GetPasswordOption>().singleOrNull()
      ?: return null
    if (request.credentialOptions.size != 1) return null
    val target = CredentialTargetClassifier.fromCallingApp(context, request.callingAppInfo)
      ?: return null
    val entryId = intent.getStringExtra(AutofillIntents.EXTRA_SELECTED_ENTRY_ID)
      ?.takeIf { it.isNotEmpty() && it.length <= 256 } ?: return null
    return FrameworkRequestAuthority(
      FrameworkRequestKind.CREDENTIAL_FINAL,
      target,
      selectedEntryId = entryId,
    ) to option
  }

  private fun extractAutofill(
    context: Context,
    intent: Intent,
  ): Pair<FrameworkRequestAuthority, ParsedAutofillFields>? {
    val structure = assistStructure(intent) ?: return null
    val parsed = AssistStructureParser.parse(structure) ?: return null
    val packageName = structure.activityComponent?.packageName ?: return null
    val signingIdentity = PackageSigningIdentity.fromPackage(context, packageName) ?: return null
    val target = if (parsed.webDomain == null) {
      CredentialTarget(TargetKind.APP, packageName, signingIdentity)
    } else {
      CredentialTarget(TargetKind.WEB, packageName, signingIdentity, parsed.webDomain)
    }
    return FrameworkRequestAuthority(
      FrameworkRequestKind.AUTOFILL_AUTH,
      target,
      fieldCount = parsed.fields.usernameIds.size + parsed.fields.passwordIds.size,
    ) to parsed.fields
  }

  @Suppress("DEPRECATION")
  private fun assistStructure(intent: Intent): AssistStructure? =
    if (Build.VERSION.SDK_INT >= 33) {
      intent.getParcelableExtra(AutofillManager.EXTRA_ASSIST_STRUCTURE, AssistStructure::class.java)
    } else {
      intent.getParcelableExtra(AutofillManager.EXTRA_ASSIST_STRUCTURE)
    }

  private fun updateTokens(
    intent: Intent,
    requestToken: String,
    candidateToken: String? = null,
    selectedEntryId: String? = null,
  ) {
    intent.putExtra(AutofillIntents.EXTRA_REQUEST_TOKEN, requestToken)
    if (candidateToken == null) intent.removeExtra(AutofillIntents.EXTRA_CANDIDATE_TOKEN)
    else intent.putExtra(AutofillIntents.EXTRA_CANDIDATE_TOKEN, candidateToken)
    if (selectedEntryId == null) intent.removeExtra(AutofillIntents.EXTRA_SELECTED_ENTRY_ID)
    else intent.putExtra(AutofillIntents.EXTRA_SELECTED_ENTRY_ID, selectedEntryId)
  }
}
