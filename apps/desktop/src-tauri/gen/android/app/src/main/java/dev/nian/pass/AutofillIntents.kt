package dev.nian.pass

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import java.util.concurrent.atomic.AtomicInteger

internal object AutofillIntents {
  const val EXTRA_REQUEST_TOKEN = "dev.nian.pass.extra.REQUEST_TOKEN"
  const val EXTRA_CANDIDATE_TOKEN = "dev.nian.pass.extra.CANDIDATE_TOKEN"
  private val nextRequestCode = AtomicInteger(1)

  fun credentialActivity(
    context: Context,
    requestToken: String,
    candidateToken: String? = null,
  ): PendingIntent {
    val intent = Intent(context, CredentialActivity::class.java).apply {
      putExtra(EXTRA_REQUEST_TOKEN, requestToken)
      candidateToken?.let { putExtra(EXTRA_CANDIDATE_TOKEN, it) }
      addFlags(Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS)
    }
    return PendingIntent.getActivity(
      context,
      nextRequestCode.getAndIncrement(),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE,
    )
  }
}
