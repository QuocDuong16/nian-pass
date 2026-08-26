package dev.nian.pass

import android.app.Activity
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileOutputStream
import java.nio.file.Files

@TauriPlugin
class VaultSourcePlugin(private val activity: Activity) : Plugin(activity) {
  override fun load(webView: WebView) {
    cleanupStaleImports()
  }

  @Command
  fun selectVault(invoke: Invoke) {
    try {
      val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
        addCategory(Intent.CATEGORY_OPENABLE)
        type = "*/*"
      }
      startActivityForResult(invoke, intent, "selectionResult")
    } catch (_: Exception) {
      invoke.reject("picker_failed", "picker_failed")
    }
  }

  @ActivityCallback
  fun selectionResult(invoke: Invoke, result: ActivityResult) {
    if (result.resultCode == Activity.RESULT_CANCELED) {
      invoke.resolve(JSObject().apply { put("status", "cancelled") })
      return
    }
    if (result.resultCode != Activity.RESULT_OK) {
      invoke.reject("picker_failed", "picker_failed")
      return
    }
    val uri = result.data?.data
    if (uri == null) {
      invoke.reject("picker_failed", "picker_failed")
      return
    }

    try {
      val staged = stageDocument(uri)
      val response = JSObject().apply {
        put("status", "selected")
        put("stagedPath", staged.file.absolutePath)
        put("fileName", staged.displayName)
      }
      invoke.resolve(response)
    } catch (_: Exception) {
      invoke.reject("picker_failed", "picker_failed")
    }
  }

  private fun stageDocument(uri: Uri): StagedDocument {
    val directory = stagingDirectory()
    val opaqueId = VaultSourcePolicy.opaqueId()
    val partial = File(directory, "$opaqueId.partial")
    val completed = File(directory, "$opaqueId.kdbx")
    try {
      val input = activity.contentResolver.openInputStream(uri)
        ?: throw IllegalStateException("document unavailable")
      input.use { source ->
        FileOutputStream(partial).use { destination ->
          val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
          while (true) {
            val count = source.read(buffer)
            if (count < 0) break
            destination.write(buffer, 0, count)
          }
          destination.fd.sync()
        }
      }
      if (!partial.renameTo(completed)) {
        throw IllegalStateException("staging commit failed")
      }
      return StagedDocument(completed, queryDisplayName(uri))
    } catch (error: Exception) {
      partial.delete()
      completed.delete()
      throw error
    }
  }

  private fun queryDisplayName(uri: Uri): String {
    var cursor: Cursor? = null
    return try {
      cursor = activity.contentResolver.query(
        uri,
        arrayOf(OpenableColumns.DISPLAY_NAME),
        null,
        null,
        null,
      )
      val rawName = if (cursor != null && cursor.moveToFirst()) {
        val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (index >= 0) cursor.getString(index) else null
      } else {
        null
      }
      VaultSourcePolicy.displayName(rawName)
    } finally {
      cursor?.close()
    }
  }

  private fun stagingDirectory(): File {
    val directory = File(activity.noBackupFilesDir, IMPORT_DIRECTORY)
    if (Files.isSymbolicLink(directory.toPath())) {
      throw IllegalStateException("invalid staging directory")
    }
    if (!directory.exists() && !directory.mkdir()) {
      throw IllegalStateException("staging directory unavailable")
    }
    if (!directory.isDirectory) {
      throw IllegalStateException("invalid staging directory")
    }
    return directory
  }

  private fun cleanupStaleImports() {
    val directory = File(activity.noBackupFilesDir, IMPORT_DIRECTORY)
    if (!directory.exists() || !directory.isDirectory || Files.isSymbolicLink(directory.toPath())) {
      return
    }
    directory.listFiles()?.forEach { candidate ->
      if (
        !Files.isSymbolicLink(candidate.toPath()) &&
        candidate.isFile &&
        VaultSourcePolicy.isManagedStagingName(candidate.name)
      ) {
        candidate.delete()
      }
    }
  }

  private data class StagedDocument(val file: File, val displayName: String)

  private companion object {
    const val IMPORT_DIRECTORY = "nian-pass-imports"
    const val DEFAULT_BUFFER_SIZE = 32 * 1024
  }
}
