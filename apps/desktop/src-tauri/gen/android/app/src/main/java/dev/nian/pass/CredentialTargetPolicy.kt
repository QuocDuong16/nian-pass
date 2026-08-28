package dev.nian.pass

import android.content.Context
import androidx.credentials.provider.CallingAppInfo
import java.net.IDN
import java.net.URI
import java.util.Locale

internal object PrivilegedBrowserAllowlist {
  @Volatile private var cached: String? = null

  fun load(context: Context): String = cached ?: synchronized(this) {
    cached ?: context.resources
      .openRawResource(R.raw.credential_privileged_apps_v1)
      .bufferedReader(Charsets.UTF_8)
      .use { it.readText() }
      .also { cached = it }
  }
}

internal object WebCredentialOrigin {
  fun canonicalHost(origin: String): String? {
    return try {
      val parsed = URI(origin)
      if (
        !parsed.scheme.equals("https", ignoreCase = true) ||
        parsed.rawUserInfo != null ||
        !parsed.rawPath.isNullOrEmpty() ||
        parsed.rawQuery != null ||
        parsed.rawFragment != null
      ) return null
      val host = parsed.host?.trimEnd('.')?.takeIf { it.isNotEmpty() } ?: return null
      IDN.toASCII(host, IDN.USE_STD3_ASCII_RULES).lowercase(Locale.ROOT)
    } catch (_: Exception) {
      null
    }
  }
}

internal object CredentialTargetClassifier {
  fun classify(
    packageName: String,
    signingIdentity: String,
    originPopulated: Boolean,
    verifiedOrigin: () -> String?,
  ): CredentialTarget? {
    if (packageName.isEmpty() || signingIdentity.isEmpty()) return null
    if (!originPopulated) {
      return CredentialTarget(TargetKind.APP, packageName, signingIdentity)
    }
    val origin = try {
      verifiedOrigin()
    } catch (_: Exception) {
      return null
    }
    val host = origin?.let(WebCredentialOrigin::canonicalHost) ?: return null
    return CredentialTarget(TargetKind.WEB, packageName, signingIdentity, host)
  }

  fun fromCallingApp(context: Context, caller: CallingAppInfo): CredentialTarget? {
    val signingIdentity = PackageSigningIdentity.fromCallingApp(caller) ?: return null
    return classify(
      packageName = caller.packageName,
      signingIdentity = signingIdentity,
      originPopulated = caller.isOriginPopulated(),
      verifiedOrigin = { caller.getOrigin(PrivilegedBrowserAllowlist.load(context)) },
    )
  }
}
