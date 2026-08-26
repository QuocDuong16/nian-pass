package dev.nian.pass

import java.util.UUID

internal object VaultSourcePolicy {
  private const val FALLBACK_NAME = "Selected vault"
  private val managedName = Regex(
    "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(kdbx|partial)$",
  )

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
}
