package dev.nian.pass

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap

internal object AutofillIntents {
  const val EXTRA_REQUEST_TOKEN = "dev.nian.pass.extra.REQUEST_TOKEN"
  const val EXTRA_CANDIDATE_TOKEN = "dev.nian.pass.extra.CANDIDATE_TOKEN"
  const val EXTRA_SELECTED_ENTRY_ID = "dev.nian.pass.extra.SELECTED_ENTRY_ID"

  fun credentialActivity(
    context: Context,
    requestToken: String,
    candidateToken: String? = null,
    selectedEntryId: String? = null,
  ): PendingIntent {
    val intent = Intent(context, CredentialActivity::class.java).apply {
      data = Uri.parse(PendingIntentIdentity.newDataUri())
      putExtra(EXTRA_REQUEST_TOKEN, requestToken)
      candidateToken?.let { putExtra(EXTRA_CANDIDATE_TOKEN, it) }
      selectedEntryId?.let { putExtra(EXTRA_SELECTED_ENTRY_ID, it) }
      addFlags(Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS)
    }
    return PendingIntent.getActivity(
      context,
      0,
      intent,
      PendingIntent.FLAG_MUTABLE,
    )
  }
}

internal object PendingIntentIdentity {
  private const val PREFIX = "nianpass://credential/"
  private val random = SecureRandom()
  private val tokenPattern = Regex("^[0-9a-f]{48}$")

  fun newDataUri(source: SecureRandom = random): String {
    val bytes = ByteArray(24)
    source.nextBytes(bytes)
    return PREFIX + bytes.joinToString("") { "%02x".format(it) }
  }

  fun isValid(dataUri: String?): Boolean = dataUri
    ?.takeIf { it.startsWith(PREFIX) }
    ?.removePrefix(PREFIX)
    ?.let(tokenPattern::matches) == true
}

internal class PendingIntentUseRegistry(
  private val clock: () -> Long = android.os.SystemClock::elapsedRealtime,
) {
  private val retired = ConcurrentHashMap<String, Long>()

  fun isRetired(identity: String): Boolean {
    cleanup()
    return retired.containsKey(identity)
  }

  fun retire(identity: String) {
    cleanup()
    retired[identity] = clock()
  }

  private fun cleanup() {
    val oldest = clock() - AutofillRequestRegistry.TTL_MILLIS
    retired.entries.removeIf { it.value < oldest }
  }
}
