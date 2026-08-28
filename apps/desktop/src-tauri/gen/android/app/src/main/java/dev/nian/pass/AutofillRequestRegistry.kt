package dev.nian.pass

import android.os.SystemClock
import android.view.autofill.AutofillId
import androidx.credentials.provider.BeginGetPasswordOption
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap

internal enum class RequestKind { CREDENTIAL_QUERY, CREDENTIAL_FULFILLMENT, AUTOFILL }
internal enum class TargetKind { APP, WEB }

internal data class CredentialTarget(
  val kind: TargetKind,
  val packageName: String,
  val signingIdentity: String,
  val webDomain: String? = null,
) {
  fun display(): String = webDomain ?: packageName
}

internal data class ParsedAutofillFields(
  val usernameIds: List<AutofillId>,
  val passwordIds: List<AutofillId>,
)

internal sealed class AndroidRequestRecord(
  val token: String,
  val target: CredentialTarget,
  val createdAt: Long,
) {
  class Credential(
    token: String,
    target: CredentialTarget,
    createdAt: Long,
    val option: BeginGetPasswordOption,
  ) : AndroidRequestRecord(token, target, createdAt)

  class Autofill(
    token: String,
    target: CredentialTarget,
    createdAt: Long,
    val fields: ParsedAutofillFields,
  ) : AndroidRequestRecord(token, target, createdAt)
}

internal data class CandidateAuthority(
  val token: String,
  val requestToken: String,
  val entryId: String,
  val createdAt: Long,
)

internal class AutofillRequestRegistry(
  private val clock: () -> Long = SystemClock::elapsedRealtime,
  private val random: SecureRandom = SecureRandom(),
) {
  private val requests = ConcurrentHashMap<String, AndroidRequestRecord>()
  private val candidates = ConcurrentHashMap<String, CandidateAuthority>()

  fun registerCredential(target: CredentialTarget, option: BeginGetPasswordOption): String {
    cleanupExpired()
    val token = opaqueToken()
    requests[token] = AndroidRequestRecord.Credential(token, target, clock(), option)
    return token
  }

  fun registerAutofill(target: CredentialTarget, fields: ParsedAutofillFields): String {
    cleanupExpired()
    val token = opaqueToken()
    requests[token] = AndroidRequestRecord.Autofill(token, target, clock(), fields)
    return token
  }

  fun request(token: String): AndroidRequestRecord? {
    cleanupExpired()
    return requests[token]
  }

  fun registerCandidate(requestToken: String, entryId: String): String {
    require(request(requestToken) != null)
    val token = opaqueToken()
    candidates[token] = CandidateAuthority(token, requestToken, entryId, clock())
    return token
  }

  fun candidate(token: String, requestToken: String): CandidateAuthority? {
    cleanupExpired()
    return candidates[token]?.takeIf { it.requestToken == requestToken }
  }

  /** Single-use authority removal happens only after a framework result was built. */
  fun complete(requestToken: String, candidateToken: String?): AndroidRequestRecord? {
    cleanupExpired()
    val record = requests.remove(requestToken) ?: return null
    if (candidateToken != null) {
      val candidate = candidates.remove(candidateToken)
      if (candidate?.requestToken != requestToken) {
        requests[requestToken] = record
        return null
      }
    }
    candidates.entries.removeIf { it.value.requestToken == requestToken }
    return record
  }

  fun cancel(requestToken: String) {
    requests.remove(requestToken)
    candidates.entries.removeIf { it.value.requestToken == requestToken }
  }

  fun clear() {
    candidates.clear()
    requests.clear()
  }

  private fun cleanupExpired() {
    val oldest = clock() - TTL_MILLIS
    val expired = requests.values.filter { it.createdAt < oldest }.map { it.token }.toSet()
    expired.forEach(requests::remove)
    candidates.entries.removeIf {
      it.value.createdAt < oldest || it.value.requestToken in expired
    }
  }

  private fun opaqueToken(): String {
    val bytes = ByteArray(24)
    random.nextBytes(bytes)
    return bytes.joinToString("") { "%02x".format(it) }
  }

  companion object {
    internal const val TTL_MILLIS = 120_000L
  }
}

internal object AutofillRuntime {
  val registry = AutofillRequestRegistry()
  @Volatile var activeCredentialActivity: CredentialActivity? = null
}
