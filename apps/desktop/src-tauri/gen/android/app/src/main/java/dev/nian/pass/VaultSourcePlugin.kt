package dev.nian.pass

import android.app.Activity
import android.content.Intent
import android.content.ComponentName
import android.database.Cursor
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import android.credentials.CredentialManager as FrameworkCredentialManager
import android.provider.OpenableColumns
import android.provider.Settings
import android.service.autofill.Dataset
import android.view.autofill.AutofillManager
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import android.webkit.WebView
import androidx.credentials.GetCredentialResponse
import androidx.credentials.PasswordCredential
import androidx.credentials.provider.BeginGetCredentialResponse
import androidx.credentials.provider.PasswordCredentialEntry
import androidx.credentials.provider.PendingIntentHandler
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.file.Files
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap

@TauriPlugin
class VaultSourcePlugin(private val activity: Activity) : Plugin(activity) {
  private val sources = ConcurrentHashMap<String, SourceRecord>()
  private val saves = ConcurrentHashMap<String, SaveRecord>()
  private val reads = ConcurrentHashMap<String, ReadRecord>()
  private val autofillStore by lazy { AutofillMetadataStore(activity.applicationContext) }

  override fun load(webView: WebView) {
    cleanupStaleImports()
    cleanupUnownedTransactionFiles()
  }

  @Command
  fun selectVault(invoke: Invoke) {
    try {
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "*/*"
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
        addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
      }
      startActivityForResult(invoke, intent, "selectionResult")
    } catch (_: Exception) {
      invoke.reject("picker_failed", "picker_failed")
    }
  }

  @ActivityCallback
  fun selectionResult(invoke: Invoke, result: ActivityResult) {
    if (result.resultCode == Activity.RESULT_CANCELED) {
      invoke.resolve(status("cancelled"))
      return
    }
    val data = result.data
    val uri = data?.data
    if (result.resultCode != Activity.RESULT_OK || uri == null) {
      invoke.reject("picker_failed", "picker_failed")
      return
    }

    try {
      val grantFlags = data.flags and (Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
      val persistable = data.flags and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION != 0
      var persistedFlags = 0
      if (persistable && grantFlags != 0) {
        try {
          activity.contentResolver.takePersistableUriPermission(uri, grantFlags)
          val persisted = activity.contentResolver.persistedUriPermissions.firstOrNull { it.uri == uri }
          if (persisted?.isReadPermission == true) persistedFlags = persistedFlags or Intent.FLAG_GRANT_READ_URI_PERMISSION
          if (persisted?.isWritePermission == true) persistedFlags = persistedFlags or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        } catch (_: Exception) {
          persistedFlags = 0
        }
      }
      val writable = VaultSourcePolicy.isSafelyWritable(
        readGranted = grantFlags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0,
        writeGranted = grantFlags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION != 0,
        persistableGranted = persistable,
        persistedRead = persistedFlags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0,
        persistedWrite = persistedFlags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION != 0,
      )
      val staged = stageProvider(uri, stagingDirectory(), "kdbx")
      val token = VaultSourcePolicy.opaqueId()
      val recoveryRequired = reconcileKnownTransactions(uri)
      sources[token] = SourceRecord(
        uri, persistedFlags, writable, recoveryRequired, staged, queryDisplayName(uri),
      )
      invoke.resolve(JSObject().apply {
        put("status", "selected")
        put("stagedPath", staged.absolutePath)
        put("fileName", queryDisplayName(uri))
        put("sourceToken", token)
        put("writable", writable)
        put("recoveryRequired", recoveryRequired)
      })
    } catch (_: Exception) {
      invoke.reject("picker_failed", "picker_failed")
    }
  }

  @Command
  fun prepareSave(invoke: Invoke) {
    try {
      val source = requireSource(invoke.getArgs().getString("sourceToken"))
      if (source.recoveryRequired) {
        invoke.resolve(status("recovery_required"))
        return
      }
      if (!source.writable) {
        invoke.resolve(status("persistence_unsupported"))
        return
      }
      val directory = transactionDirectory()
      val token = VaultSourcePolicy.opaqueId()
      val current = stageProvider(source.uri, directory, "current", token)
      val candidate = managedTransactionFile(directory, "$token.candidate", mustExist = false)
      val backup = managedTransactionFile(directory, "$token.backup", mustExist = false)
      val readBack = managedTransactionFile(directory, "$token.readback", mustExist = false)
      saves[token] = SaveRecord(token, source, current, candidate, backup, readBack)
      invoke.resolve(JSObject().apply {
        put("status", "ready")
        put("transactionToken", token)
        put("currentPath", current.absolutePath)
        put("candidatePath", candidate.absolutePath)
      })
    } catch (_: Exception) {
      invoke.resolve(status("failed"))
    }
  }

  @Command
  fun commitCandidate(invoke: Invoke) {
    val args = invoke.getArgs()
    val token = args.getString("transactionToken")
    val sourceToken = args.getString("sourceToken")
    val baseline = args.getString("baseline")
    val candidateIdentity = args.getString("candidate")
    val save = saves[token]
    if (
      save == null || save.source !== sources[sourceToken] ||
      !VaultSourcePolicy.isGeneration(baseline) || !VaultSourcePolicy.isGeneration(candidateIdentity)
    ) {
      invoke.resolve(status("save_failed"))
      return
    }
    var destructive = false
    try {
      val directory = transactionDirectory()
      managedTransactionFile(directory, save.candidate.name, mustExist = true)
      if (fingerprint(save.candidate) != candidateIdentity) {
        cleanupSave(save, deleteJournal = true)
        invoke.resolve(status("save_failed"))
        return
      }
      if (fingerprint(save.current) != baseline) {
        cleanupSave(save, deleteJournal = true)
        invoke.resolve(status("external_change"))
        return
      }

      copyFileVerified(save.current, save.backup, baseline)
      var journal = RecoveryJournal(
        transactionToken = token,
        sourceUri = save.source.uri.toString(),
        baseline = baseline,
        candidate = candidateIdentity,
        backupPath = save.backup.absolutePath,
        candidatePath = save.candidate.absolutePath,
        readBackPath = save.readBack.absolutePath,
        phase = SavePhase.PREPARED,
      )
      VaultSourceJournal.write(directory, journal)

      val finalCheck = stageProvider(save.source.uri, directory, "check", token)
      val stillBaseline = fingerprint(finalCheck) == baseline
      finalCheck.delete()
      if (!stillBaseline) {
        cleanupSave(save, deleteJournal = true)
        invoke.resolve(status("external_change"))
        return
      }

      journal = journal.copy(phase = SavePhase.WRITE_STARTED)
      VaultSourceJournal.write(directory, journal)
      destructive = true
      writeProvider(save.source.uri, save.candidate)
      stageProvider(save.source.uri, directory, "readback", token, replace = true)
      val finalResult = VaultSourcePolicy.finalReadResult(fingerprint(save.readBack) == candidateIdentity)
      if (finalResult != NativeCommitResult.VERIFIED) {
        save.source.recoveryRequired = true
        invoke.resolve(status(finalResult.wireValue))
        return
      }
      invoke.resolve(JSObject().apply {
        put("status", "verified")
        put("readBackPath", save.readBack.absolutePath)
      })
    } catch (_: Exception) {
      if (!destructive) {
        cleanupSave(save, deleteJournal = true)
        invoke.resolve(status("save_failed"))
      } else {
        val rollback = rollbackVerified(save, baseline)
        val result = VaultSourcePolicy.destructiveFailureResult(rollback)
        if (rollback) cleanupSave(save, deleteJournal = true) else save.source.recoveryRequired = true
        invoke.resolve(status(result.wireValue))
      }
    }
  }

  @Command
  fun finalizeSave(invoke: Invoke) {
    val args = invoke.getArgs()
    val save = saves[args.getString("transactionToken")]
    val source = sources[args.getString("sourceToken")]
    if (save == null || save.source !== source) {
      invoke.resolve(status("save_uncertain"))
      return
    }
    if (cleanupSave(save, deleteJournal = true)) {
      source.recoveryRequired = false
      invoke.resolve(status("ok"))
    } else {
      source.recoveryRequired = true
      invoke.resolve(status("save_uncertain"))
    }
  }

  @Command
  fun abortSave(invoke: Invoke) {
    val args = invoke.getArgs()
    val save = saves[args.getString("transactionToken")]
    val source = sources[args.getString("sourceToken")]
    if (save == null || save.source !== source) {
      invoke.resolve(status("failed"))
      return
    }
    val journal = VaultSourceJournal.read(File(transactionDirectory(), "${save.token}.journal"))
    if (journal?.phase == SavePhase.WRITE_STARTED) {
      source.recoveryRequired = true
      invoke.resolve(status("save_uncertain"))
    } else {
      cleanupSave(save, deleteJournal = true)
      invoke.resolve(status("ok"))
    }
  }

  @Command
  fun stageCurrent(invoke: Invoke) {
    try {
      val sourceToken = invoke.getArgs().getString("sourceToken")
      val source = requireSource(sourceToken)
      if (source.recoveryRequired || reconcileKnownTransactions(source.uri)) {
        source.recoveryRequired = true
        invoke.resolve(status("recovery_required"))
        return
      }
      val token = VaultSourcePolicy.opaqueId()
      val staged = stageProvider(source.uri, transactionDirectory(), "read", token)
      reads[token] = ReadRecord(source, staged)
      invoke.resolve(JSObject().apply {
        put("status", "ready")
        put("readToken", token)
        put("stagedPath", staged.absolutePath)
      })
    } catch (_: Exception) {
      invoke.resolve(status("failed"))
    }
  }

  @Command
  fun finishRead(invoke: Invoke) {
    val args = invoke.getArgs()
    val source = sources[args.getString("sourceToken")]
    val read = reads.remove(args.getString("transactionToken"))
    if (read != null && read.source === source && read.file.delete()) invoke.resolve(status("ok"))
    else invoke.resolve(status("failed"))
  }

  @Command
  fun releaseSource(invoke: Invoke) {
    val args = invoke.getArgs()
    val token = args.getString("sourceToken")
    val preserveRecovery = args.optBoolean("preserveRecovery", false)
    val source = sources[token]
    if (source == null || (source.recoveryRequired && !preserveRecovery)) {
      invoke.resolve(status("failed"))
      return
    }
    reads.entries.removeIf { entry ->
      if (entry.value.source !== source) false else {
        entry.value.file.delete()
        true
      }
    }
    val remembered = autofillStore.loadBookmark()?.sourceUri == source.uri.toString()
    if (!preserveRecovery) {
      val transitioned = if (remembered) {
        retainAutofillReadGrant(source.uri)
      } else {
        releasePersistedGrant(source.uri, source.persistedFlags)
      }
      if (!transitioned) {
        invoke.resolve(status("failed"))
        return
      }
    }
    source.initialStaging.delete()
    sources.remove(token)
    AutofillRuntime.registry.clear()
    invoke.resolve(status("ok"))
  }

  @Command
  fun autofillStatus(invoke: Invoke) {
    val bookmark = validBookmark()
    val manager = activity.getSystemService(AutofillManager::class.java)
    val credentialProviderSelected = if (Build.VERSION.SDK_INT >= 34) {
      try {
        activity.getSystemService(FrameworkCredentialManager::class.java)
          ?.isEnabledCredentialProviderService(
            ComponentName(activity, NianCredentialProviderService::class.java),
          ) == true
      } catch (_: Exception) {
        false
      }
    } else false
    invoke.resolve(JSObject().apply {
      put("supported", Build.VERSION.SDK_INT >= 26)
      put("sourceEnabled", bookmark != null)
      put("providerSelected", credentialProviderSelected || manager?.hasEnabledAutofillServices() == true)
    })
  }

  @Command
  fun enableAutofill(invoke: Invoke) {
    try {
      val source = requireSource(invoke.getArgs().getString("sourceToken"))
      val autofillFlags = AutofillGrantPolicy.bookmarkFlags(source.persistedFlags)
      if (autofillFlags == null) {
        invoke.resolve(status("failed"))
        return
      }
      val prior = autofillStore.loadBookmark()
      if (prior != null && prior.sourceUri != source.uri.toString()) {
        invoke.resolve(status("failed"))
        return
      }
      val associations = prior?.takeIf { it.sourceUri == source.uri.toString() }?.associations.orEmpty()
      val saved = autofillStore.saveBookmark(
        AutofillMetadata(
          source.uri.toString(), autofillFlags, source.displayName, associations,
        ),
      )
      if (!saved) {
        invoke.resolve(status("failed"))
        return
      }
      invoke.resolve(status("ok"))
    } catch (_: Exception) {
      invoke.resolve(status("failed"))
    }
  }

  @Command
  fun disableAutofill(invoke: Invoke) {
    val bookmark = autofillStore.loadBookmark()
    if (bookmark == null) {
      invoke.resolve(status("ok"))
      return
    }
    try {
      val active = sources.values.firstOrNull { it.uri.toString() == bookmark.sourceUri }
      if (!autofillStore.deleteBookmark()) {
        invoke.resolve(status("failed"))
        return
      }
      val persistedFlags = persistedGrantFlags(Uri.parse(bookmark.sourceUri))
      val releaseFlags = AutofillGrantPolicy.disableReleaseFlags(active != null, persistedFlags)
      if (releaseFlags != 0 && !releasePersistedGrant(Uri.parse(bookmark.sourceUri), releaseFlags)) {
        autofillStore.saveBookmark(bookmark)
        invoke.resolve(status("failed"))
        return
      }
      AutofillRuntime.registry.clear()
      invoke.resolve(status("ok"))
    } catch (_: Exception) {
      invoke.resolve(status("failed"))
    }
  }

  @Command
  fun rehydrateAutofillSource(invoke: Invoke) {
    val bookmark = validBookmark()
    if (bookmark == null) {
      invoke.resolve(status("unavailable"))
      return
    }
    try {
      val uri = Uri.parse(bookmark.sourceUri)
      val staged = stageProvider(uri, stagingDirectory(), "kdbx")
      val token = VaultSourcePolicy.opaqueId()
      val writable = AutofillGrantPolicy.coldSourceWritable()
      val recoveryRequired = reconcileKnownTransactions(uri)
      sources[token] = SourceRecord(
        uri, AutofillGrantPolicy.READ, writable, recoveryRequired, staged,
        VaultSourcePolicy.displayName(bookmark.displayName),
      )
      invoke.resolve(JSObject().apply {
        put("status", "selected")
        put("stagedPath", staged.absolutePath)
        put("fileName", VaultSourcePolicy.displayName(bookmark.displayName))
        put("sourceToken", token)
        put("writable", writable)
        put("recoveryRequired", recoveryRequired)
      })
    } catch (_: Exception) {
      invoke.resolve(status("unavailable"))
    }
  }

  @Command
  fun describeAutofillRequest(invoke: Invoke) {
    val credentialActivity = AutofillRuntime.activeCredentialActivity
    val requestToken = credentialActivity?.intent?.getStringExtra(AutofillIntents.EXTRA_REQUEST_TOKEN)
    val candidateToken = credentialActivity?.intent?.getStringExtra(AutofillIntents.EXTRA_CANDIDATE_TOKEN)
    val record = requestToken?.let(AutofillRuntime.registry::request)
    if (record == null || PackageSigningIdentity.fromPackage(activity, record.target.packageName) != record.target.signingIdentity) {
      invoke.resolve(status("unavailable"))
      return
    }
    val candidate = candidateToken?.let { AutofillRuntime.registry.candidate(it, requestToken) }
    if (candidateToken != null && candidate == null) {
      invoke.resolve(status("unavailable"))
      return
    }
    val trusted = record.target.kind == TargetKind.APP && autofillStore.isTrusted(
      record.target.packageName, record.target.signingIdentity,
    )
    invoke.resolve(JSObject().apply {
      put("status", "available")
      put("requestToken", requestToken)
      put("kind", when {
        record is AndroidRequestRecord.Autofill -> "autofill"
        candidate != null -> "credential_fulfillment"
        else -> "credential_query"
      })
      put("targetKind", record.target.kind.name.lowercase())
      put("packageName", record.target.packageName)
      put("signingIdentity", record.target.signingIdentity)
      record.target.webDomain?.let { put("webDomain", it) }
      put("trusted", trusted)
      candidate?.let { put("selectedEntryId", it.entryId) }
    })
  }

  @Command
  fun publishAutofillCandidates(invoke: Invoke) {
    val credentialActivity = AutofillRuntime.activeCredentialActivity
    val args = invoke.getArgs()
    val requestToken = args.getString("requestToken")
    val record = AutofillRuntime.registry.request(requestToken) as? AndroidRequestRecord.Credential
    if (credentialActivity == null || record == null) {
      invoke.resolve(status("failed"))
      return
    }
    try {
      val candidates = args.getJSONArray("candidates")
      val response = BeginGetCredentialResponse.Builder()
      for (index in 0 until candidates.length()) {
        val candidate = candidates.getJSONObject(index)
        val entryId = candidate.getString("entryId")
        val title = summaryLabel(candidate.getJSONObject("title"), "Nian Pass account")
        val username = summaryLabel(candidate.getJSONObject("username"), title)
        val candidateToken = AutofillRuntime.registry.registerCandidate(requestToken, entryId)
        val pendingIntent = AutofillIntents.credentialActivity(
          activity, requestToken, candidateToken, entryId,
        )
        val option = record.option ?: throw IllegalStateException("query option unavailable")
        response.addCredentialEntry(
          PasswordCredentialEntry.Builder(activity, username, pendingIntent, option)
            .setDisplayName(title)
            .setAutoSelectAllowed(false)
            .build(),
        )
      }
      if (candidates.length() == 0) {
        invoke.resolve(status("failed"))
        return
      }
      val result = Intent()
      PendingIntentHandler.setBeginGetCredentialResponse(result, response.build())
      if (!credentialActivity.completeCurrentRequest(requestToken)) {
        invoke.resolve(status("failed"))
        return
      }
      credentialActivity.setResult(Activity.RESULT_OK, result)
      credentialActivity.finish()
      invoke.resolve(status("ok"))
    } catch (_: Exception) {
      invoke.resolve(status("failed"))
    }
  }

  @Command
  fun fulfillAutofill(invoke: Invoke) {
    val credentialActivity = AutofillRuntime.activeCredentialActivity
    val args = invoke.getArgs()
    val requestToken = args.getString("requestToken")
    val entryId = args.getString("entryId")
    val approved = args.optBoolean("approved", false)
    val username = args.getString("username")
    val password = args.getString("password")
    val candidateToken = credentialActivity?.intent?.getStringExtra(AutofillIntents.EXTRA_CANDIDATE_TOKEN)
    val record = AutofillRuntime.registry.request(requestToken)
    val candidate = candidateToken?.let { AutofillRuntime.registry.candidate(it, requestToken) }
    val trusted = record?.target?.kind == TargetKind.APP && record.let {
      autofillStore.isTrusted(it.target.packageName, it.target.signingIdentity)
    }
    if (
      credentialActivity == null || record == null ||
      (record is AndroidRequestRecord.Credential && (candidate == null || candidate.entryId != entryId)) ||
      (!trusted && !approved)
      || PackageSigningIdentity.fromPackage(activity, record.target.packageName) != record.target.signingIdentity
    ) {
      invoke.resolve(status("failed"))
      return
    }
    try {
      val result = Intent()
      when (record) {
        is AndroidRequestRecord.Credential -> {
          PendingIntentHandler.setGetCredentialResponse(
            result,
            GetCredentialResponse(PasswordCredential(username, password)),
          )
        }
        is AndroidRequestRecord.Autofill -> {
          val presentation = RemoteViews(activity.packageName, android.R.layout.simple_list_item_1).apply {
            setTextViewText(android.R.id.text1, "Nian Pass credential")
          }
          val dataset = Dataset.Builder(presentation).apply {
            record.fields.usernameIds.forEach { id ->
              setValue(id, AutofillValue.forText(username), presentation)
            }
            record.fields.passwordIds.forEach { id ->
              setValue(id, AutofillValue.forText(password), presentation)
            }
          }.build()
          result.putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, dataset)
          if (Build.VERSION.SDK_INT >= 31) {
            result.putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT_EPHEMERAL_DATASET, true)
          }
        }
      }
      if (
        AutofillRuntime.registry.complete(requestToken, candidateToken) == null ||
        !credentialActivity.completeCurrentRequest(requestToken)
      ) {
        invoke.resolve(status("failed"))
        return
      }
      if (!trusted && approved && record.target.kind == TargetKind.APP) {
        autofillStore.saveAssociation(record.target.packageName, record.target.signingIdentity)
      }
      credentialActivity.setResult(Activity.RESULT_OK, result)
      credentialActivity.finish()
      invoke.resolve(status("ok"))
    } catch (_: Exception) {
      invoke.resolve(status("failed"))
    }
  }

  @Command
  fun cancelAutofill(invoke: Invoke) {
    val requestToken = invoke.getArgs().getString("requestToken")
    AutofillRuntime.registry.cancel(requestToken)
    AutofillRuntime.activeCredentialActivity?.apply {
      if (completeCurrentRequest(requestToken)) {
        setResult(Activity.RESULT_CANCELED)
        finish()
      }
    }
    invoke.resolve(status("ok"))
  }

  @Command
  fun openAutofillSettings(invoke: Invoke) {
    try {
      val intent = if (Build.VERSION.SDK_INT >= 34) {
        Intent("android.settings.CREDENTIAL_PROVIDER")
      } else {
        Intent(Settings.ACTION_REQUEST_SET_AUTOFILL_SERVICE).apply {
          data = Uri.parse("package:${activity.packageName}")
        }
      }
      activity.startActivity(intent)
      invoke.resolve(status("ok"))
    } catch (_: Exception) {
      invoke.resolve(status("failed"))
    }
  }

  @Command
  fun securityStatus(invoke: Invoke) {
    invoke.resolve(securitySnapshot(MobileSecurityRuntime.status(activity)))
  }

  @Command
  fun acknowledgeSafeUi(invoke: Invoke) {
    val generation = try {
      invoke.getArgs().getLong("generation")
    } catch (_: Exception) {
      invoke.resolve(status("stale"))
      return
    }
    val acknowledged = MobileSecurityRuntime.acknowledgeSafeUi(activity, generation)
    invoke.resolve(status(if (acknowledged) "acknowledged" else "stale"))
  }

  private fun validBookmark(): AutofillMetadata? {
    val bookmark = autofillStore.loadBookmark() ?: return null
    return try {
      val uri = Uri.parse(bookmark.sourceUri)
      val active = sources.values.any { it.uri == uri }
      if (!active && !retainAutofillReadGrant(uri)) return null
      val persisted = activity.contentResolver.persistedUriPermissions.firstOrNull { it.uri == uri }
      bookmark.takeIf {
        it.grantFlags == AutofillGrantPolicy.READ && persisted?.isReadPermission == true
      }
    } catch (_: Exception) {
      null
    }
  }

  private fun securitySnapshot(snapshot: MobileSecuritySnapshot): JSObject = JSObject().apply {
    put("status", "ok")
    put("foreground", snapshot.foreground)
    put("elapsedRealtimeMs", snapshot.elapsedRealtimeMs)
    put("generation", snapshot.generation)
    put("screenState", when (snapshot.screenState) {
      MobileScreenState.ACTIVE -> "active"
      MobileScreenState.SCREEN_OFF -> "screen_off"
      MobileScreenState.DEVICE_LOCKED -> "device_locked"
    })
    put("curtainVisible", snapshot.curtainVisible)
  }

  private fun retainAutofillReadGrant(uri: Uri): Boolean = AutofillGrantPolicy.retainReadOnly(
    object : PersistedGrantController {
      override fun currentFlags(): Int = persistedGrantFlags(uri)

      override fun release(flags: Int) {
        activity.contentResolver.releasePersistableUriPermission(uri, flags)
      }
    },
  )

  private fun releasePersistedGrant(uri: Uri, requestedFlags: Int): Boolean {
    val actual = persistedGrantFlags(uri)
    val flags = requestedFlags and actual and (AutofillGrantPolicy.READ or AutofillGrantPolicy.WRITE)
    if (flags == 0) return actual == 0
    return try {
      activity.contentResolver.releasePersistableUriPermission(uri, flags)
      persistedGrantFlags(uri) and flags == 0
    } catch (_: Exception) {
      false
    }
  }

  private fun persistedGrantFlags(uri: Uri): Int {
    val persisted = activity.contentResolver.persistedUriPermissions.firstOrNull { it.uri == uri }
      ?: return 0
    var flags = 0
    if (persisted.isReadPermission) flags = flags or AutofillGrantPolicy.READ
    if (persisted.isWritePermission) flags = flags or AutofillGrantPolicy.WRITE
    return flags
  }

  private fun summaryLabel(value: org.json.JSONObject, fallback: String): String =
    if (value.optString("kind") == "visible") value.optString("value").ifEmpty { fallback }
    else fallback

  private fun requireSource(token: String): SourceRecord {
    if (!VaultSourcePolicy.isOpaqueId(token)) throw IllegalArgumentException("invalid source")
    return sources[token] ?: throw IllegalArgumentException("unknown source")
  }

  private fun stageProvider(
    uri: Uri,
    directory: File,
    suffix: String,
    opaqueId: String = VaultSourcePolicy.opaqueId(),
    replace: Boolean = false,
  ): File {
    val completed = managedTransactionOrImportFile(directory, "$opaqueId.$suffix", mustExist = false)
    val partial = managedTransactionOrImportFile(directory, "$opaqueId.partial", mustExist = false)
    if (replace) completed.delete()
    partial.delete()
    try {
      val input = activity.contentResolver.openInputStream(uri) ?: throw IllegalStateException("source unavailable")
      input.use { source ->
        FileOutputStream(partial).use { destination ->
          copyStream(source, destination)
          destination.flush()
          destination.fd.sync()
        }
      }
      if (!partial.renameTo(completed)) throw IllegalStateException("staging commit failed")
      return completed
    } catch (error: Exception) {
      partial.delete()
      completed.delete()
      throw error
    }
  }

  private fun writeProvider(uri: Uri, candidate: File) {
    val descriptor = activity.contentResolver.openFileDescriptor(uri, "rwt")
      ?: throw IllegalStateException("provider write unavailable")
    FileInputStream(candidate).use { source ->
      ParcelFileDescriptor.AutoCloseOutputStream(descriptor).use { destination ->
        copyStream(source, destination)
        destination.flush()
        destination.fd.sync()
      }
    }
  }

  private fun rollbackVerified(save: SaveRecord, baseline: String): Boolean = try {
    writeProvider(save.source.uri, save.backup)
    stageProvider(save.source.uri, transactionDirectory(), "readback", save.token, replace = true)
    fingerprint(save.readBack) == baseline
  } catch (_: Exception) {
    false
  }

  private fun copyFileVerified(source: File, destination: File, expected: String) {
    destination.delete()
    FileInputStream(source).use { input ->
      FileOutputStream(destination).use { output ->
        copyStream(input, output)
        output.flush()
        output.fd.sync()
      }
    }
    if (fingerprint(destination) != expected) throw IllegalStateException("backup verification failed")
  }

  private fun copyStream(source: java.io.InputStream, destination: java.io.OutputStream) {
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    while (true) {
      val count = source.read(buffer)
      if (count < 0) break
      destination.write(buffer, 0, count)
    }
  }

  private fun fingerprint(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    var size = 0L
    FileInputStream(file).use { source ->
      val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
      while (true) {
        val count = source.read(buffer)
        if (count < 0) break
        size = Math.addExact(size, count.toLong())
        digest.update(buffer, 0, count)
      }
    }
    return "$size:${digest.digest().joinToString("") { byte -> "%02x".format(byte.toInt() and 0xff) }}"
  }

  private fun reconcileKnownTransactions(uri: Uri): Boolean {
    val directory = transactionDirectory()
    for ((journalFile, journal) in VaultSourceJournal.list(directory)) {
      if (journal == null) return true
      if (journal.sourceUri != uri.toString()) continue
      val current = try {
        val check = stageProvider(uri, directory, "check")
        val identity = fingerprint(check)
        check.delete()
        identity
      } catch (_: Exception) {
        return true
      }
      if (
        VaultSourcePolicy.recoveryDecision(current, journal.baseline, journal.candidate) ==
        RecoveryDecision.REQUIRES_RECONCILIATION
      ) return true
      cleanupJournalFiles(journal)
      VaultSourceJournal.delete(directory, journal.transactionToken)
      journalFile.delete()
    }
    return false
  }

  private fun cleanupSave(save: SaveRecord, deleteJournal: Boolean): Boolean {
    var complete = true
    for (file in listOf(save.current, save.candidate, save.backup, save.readBack)) {
      if (file.exists() && !file.delete()) complete = false
    }
    if (deleteJournal && !VaultSourceJournal.delete(transactionDirectory(), save.token)) complete = false
    saves.remove(save.token)
    return complete
  }

  private fun cleanupJournalFiles(journal: RecoveryJournal) {
    for (path in listOf(journal.backupPath, journal.candidatePath, journal.readBackPath)) {
      try { managedTransactionFile(transactionDirectory(), File(path).name, mustExist = false).delete() } catch (_: Exception) { }
    }
    managedTransactionFile(transactionDirectory(), "${journal.transactionToken}.current", mustExist = false).delete()
  }

  private fun queryDisplayName(uri: Uri): String {
    var cursor: Cursor? = null
    return try {
      cursor = activity.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
      val rawName = if (cursor != null && cursor.moveToFirst()) {
        val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (index >= 0) cursor.getString(index) else null
      } else null
      VaultSourcePolicy.displayName(rawName)
    } finally { cursor?.close() }
  }

  private fun stagingDirectory(): File = privateDirectory(IMPORT_DIRECTORY)
  private fun transactionDirectory(): File = privateDirectory(TRANSACTION_DIRECTORY)

  private fun privateDirectory(name: String): File {
    val directory = File(activity.noBackupFilesDir, name)
    if (Files.isSymbolicLink(directory.toPath())) throw IllegalStateException("invalid private directory")
    if (!directory.exists() && !directory.mkdir()) throw IllegalStateException("private directory unavailable")
    if (!directory.isDirectory) throw IllegalStateException("invalid private directory")
    return directory
  }

  private fun managedTransactionFile(directory: File, name: String, mustExist: Boolean): File {
    if (!VaultSourcePolicy.isTransactionName(name)) throw IllegalArgumentException("invalid transaction file")
    return managedFile(directory, name, mustExist)
  }

  private fun managedTransactionOrImportFile(directory: File, name: String, mustExist: Boolean): File {
    val valid = VaultSourcePolicy.isTransactionName(name) || VaultSourcePolicy.isManagedStagingName(name)
    if (!valid) throw IllegalArgumentException("invalid private file")
    return managedFile(directory, name, mustExist)
  }

  private fun managedFile(directory: File, name: String, mustExist: Boolean): File {
    val file = File(directory, name)
    if (file.parentFile?.canonicalFile != directory.canonicalFile || Files.isSymbolicLink(file.toPath())) {
      throw IllegalArgumentException("invalid private file")
    }
    if (mustExist && !file.isFile) throw IllegalArgumentException("missing private file")
    return file
  }

  private fun cleanupStaleImports() {
    val directory = File(activity.noBackupFilesDir, IMPORT_DIRECTORY)
    if (!directory.exists() || !directory.isDirectory || Files.isSymbolicLink(directory.toPath())) return
    directory.listFiles()?.forEach { candidate ->
      if (!Files.isSymbolicLink(candidate.toPath()) && candidate.isFile && VaultSourcePolicy.isManagedStagingName(candidate.name)) candidate.delete()
    }
  }

  private fun cleanupUnownedTransactionFiles() {
    val directory = File(activity.noBackupFilesDir, TRANSACTION_DIRECTORY)
    if (!directory.exists() || !directory.isDirectory || Files.isSymbolicLink(directory.toPath())) return
    val journals = VaultSourceJournal.list(directory)
    if (journals.any { (_, journal) -> journal == null }) return
    val retained = journals.flatMap { (_, journal) ->
      if (journal == null) emptyList() else listOf(
        File(journal.backupPath).name, File(journal.candidatePath).name,
        File(journal.readBackPath).name, "${journal.transactionToken}.current",
      )
    }.toSet()
    directory.listFiles()?.forEach { candidate ->
      if (
        candidate.isFile && !Files.isSymbolicLink(candidate.toPath()) &&
        VaultSourcePolicy.isTransactionName(candidate.name) && candidate.name !in retained
      ) candidate.delete()
    }
  }

  private fun status(value: String): JSObject = JSObject().apply { put("status", value) }

  private data class SourceRecord(
    val uri: Uri,
    val persistedFlags: Int,
    val writable: Boolean,
    @Volatile var recoveryRequired: Boolean,
    val initialStaging: File,
    val displayName: String,
  )
  private data class SaveRecord(
    val token: String,
    val source: SourceRecord,
    val current: File,
    val candidate: File,
    val backup: File,
    val readBack: File,
  )
  private data class ReadRecord(val source: SourceRecord, val file: File)

  private companion object {
    const val IMPORT_DIRECTORY = "nian-pass-imports"
    const val TRANSACTION_DIRECTORY = "nian-pass-transactions"
    const val DEFAULT_BUFFER_SIZE = 64 * 1024
  }
}
