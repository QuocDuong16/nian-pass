package dev.nian.pass

import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.nio.charset.StandardCharsets

internal enum class SavePhase { PREPARED, WRITE_STARTED }

internal data class RecoveryJournal(
  val transactionToken: String,
  val sourceUri: String,
  val baseline: String,
  val candidate: String,
  val backupPath: String,
  val candidatePath: String,
  val readBackPath: String,
  val phase: SavePhase,
)

internal object VaultSourceJournal {
  fun write(directory: File, journal: RecoveryJournal) {
    val target = journalFile(directory, journal.transactionToken)
    val atomic = AtomicFile(target)
    var output = atomic.startWrite()
    try {
      val value = JSONObject().apply {
        put("version", 1)
        put("transactionToken", journal.transactionToken)
        put("sourceUri", journal.sourceUri)
        put("baseline", journal.baseline)
        put("candidate", journal.candidate)
        put("backupPath", journal.backupPath)
        put("candidatePath", journal.candidatePath)
        put("readBackPath", journal.readBackPath)
        put("phase", journal.phase.name)
      }.toString().toByteArray(StandardCharsets.UTF_8)
      output.write(value)
      output.flush()
      output.fd.sync()
      atomic.finishWrite(output)
    } catch (error: Exception) {
      atomic.failWrite(output)
      throw error
    }
  }

  fun read(file: File): RecoveryJournal? {
    return try {
      val value = AtomicFile(file).openRead().bufferedReader(StandardCharsets.UTF_8).use { reader ->
        JSONObject(reader.readText())
      }
      if (value.optInt("version") != 1) return null
      val journal = RecoveryJournal(
        transactionToken = value.getString("transactionToken"),
        sourceUri = value.getString("sourceUri"),
        baseline = value.getString("baseline"),
        candidate = value.getString("candidate"),
        backupPath = value.getString("backupPath"),
        candidatePath = value.getString("candidatePath"),
        readBackPath = value.getString("readBackPath"),
        phase = SavePhase.valueOf(value.getString("phase")),
      )
      if (!isSelfConsistent(file, journal)) null else journal
    } catch (_: Exception) {
      null
    }
  }

  fun list(directory: File): List<Pair<File, RecoveryJournal?>> =
    directory.listFiles()
      ?.filter { it.isFile && !java.nio.file.Files.isSymbolicLink(it.toPath()) && VaultSourcePolicy.isJournalName(it.name) }
      ?.map { it to read(it) }
      .orEmpty()

  fun delete(directory: File, transactionToken: String): Boolean {
    val atomic = AtomicFile(journalFile(directory, transactionToken))
    atomic.delete()
    return !atomic.baseFile.exists()
  }

  private fun journalFile(directory: File, transactionToken: String): File {
    if (!VaultSourcePolicy.isOpaqueId(transactionToken)) throw IllegalArgumentException("invalid transaction")
    return File(directory, "$transactionToken.journal")
  }

  private fun isSelfConsistent(file: File, journal: RecoveryJournal): Boolean {
    val token = journal.transactionToken
    if (!VaultSourcePolicy.isOpaqueId(token) || file.name != "$token.journal") return false
    val expected = mapOf(
      journal.backupPath to "$token.backup",
      journal.candidatePath to "$token.candidate",
      journal.readBackPath to "$token.readback",
    )
    return expected.all { (path, name) ->
      val candidate = File(path)
      candidate.name == name && candidate.parentFile?.canonicalFile == file.parentFile?.canonicalFile
    }
  }
}
