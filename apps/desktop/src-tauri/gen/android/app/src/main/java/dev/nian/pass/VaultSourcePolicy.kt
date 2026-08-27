package dev.nian.pass

import java.util.UUID

internal object VaultSourcePolicy {
  private const val FALLBACK_NAME = "Selected vault"
  private val managedName = Regex(
    "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(kdbx|partial)$",
  )
  private val opaqueId = Regex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
  private val transactionName = Regex(
    "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(current|candidate|backup|readback|check|read|partial)$",
  )
  private val generation = Regex("^(0|[1-9][0-9]*):[0-9a-f]{64}$")

  fun displayName(value: String?): String {
    val safe = value
      ?.map { character ->
        if (character.isISOControl() || character == '/' || character == '\\') '\uFFFD' else character
      }
      ?.joinToString("")
      ?.trim()
      ?.take(160)
      .orEmpty()
    return safe.ifEmpty { FALLBACK_NAME }
  }

  fun opaqueId(): String = UUID.randomUUID().toString()

  fun isManagedStagingName(name: String): Boolean = managedName.matches(name)

  fun isOpaqueId(value: String): Boolean = opaqueId.matches(value)

  fun isTransactionName(name: String): Boolean = transactionName.matches(name)

  fun isJournalName(name: String): Boolean =
    name.endsWith(".journal") && isOpaqueId(name.removeSuffix(".journal"))

  fun isGeneration(value: String): Boolean = generation.matches(value)

  fun isSafelyWritable(
    readGranted: Boolean,
    writeGranted: Boolean,
    persistableGranted: Boolean,
    persistedRead: Boolean,
    persistedWrite: Boolean,
  ): Boolean = readGranted && writeGranted && persistableGranted && persistedRead && persistedWrite

  fun recoveryDecision(current: String, baseline: String, candidate: String): RecoveryDecision =
    when (current) {
      baseline -> RecoveryDecision.ORIGINAL_KNOWN
      candidate -> RecoveryDecision.CANDIDATE_KNOWN
      else -> RecoveryDecision.REQUIRES_RECONCILIATION
    }

  fun finalReadResult(candidateMatches: Boolean): NativeCommitResult =
    if (candidateMatches) NativeCommitResult.VERIFIED else NativeCommitResult.SAVE_UNCERTAIN

  fun destructiveFailureResult(rollbackVerified: Boolean): NativeCommitResult =
    if (rollbackVerified) NativeCommitResult.SAVE_FAILED else NativeCommitResult.SAVE_UNCERTAIN
}

internal enum class RecoveryDecision {
  ORIGINAL_KNOWN,
  CANDIDATE_KNOWN,
  REQUIRES_RECONCILIATION,
}

internal enum class NativeCommitResult(val wireValue: String) {
  VERIFIED("verified"),
  SAVE_FAILED("save_failed"),
  SAVE_UNCERTAIN("save_uncertain"),
}
