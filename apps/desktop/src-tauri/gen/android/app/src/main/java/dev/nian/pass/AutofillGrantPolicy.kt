package dev.nian.pass

import android.content.Intent

internal interface PersistedGrantController {
  fun currentFlags(): Int
  fun release(flags: Int)
}

internal object AutofillGrantPolicy {
  const val READ: Int = Intent.FLAG_GRANT_READ_URI_PERMISSION
  const val WRITE: Int = Intent.FLAG_GRANT_WRITE_URI_PERMISSION

  fun bookmarkFlags(sourceFlags: Int): Int? =
    (sourceFlags and READ).takeIf { it == READ }

  fun normalize(metadata: AutofillMetadata): AutofillMetadata? =
    bookmarkFlags(metadata.grantFlags)?.let { metadata.copy(grantFlags = it) }

  fun coldSourceWritable(): Boolean = false

  fun disableReleaseFlags(activeNormalSession: Boolean, persistedFlags: Int): Int =
    if (activeNormalSession) 0 else persistedFlags and (READ or WRITE)

  fun retainReadOnly(controller: PersistedGrantController): Boolean {
    return try {
      val before = controller.currentFlags()
      if (before and READ == 0) return false
      if (before and WRITE != 0) controller.release(WRITE)
      val after = controller.currentFlags()
      after and READ != 0 && after and WRITE == 0
    } catch (_: Exception) {
      false
    }
  }
}
