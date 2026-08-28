package dev.nian.pass

import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import androidx.credentials.provider.CallingAppInfo
import java.security.MessageDigest

internal object PackageSigningIdentity {
  fun fromCallingApp(info: CallingAppInfo): String? = try {
    val signing = info.signingInfoCompat
    identity(signing.apkContentsSigners)
  } catch (_: Exception) {
    null
  }

  @Suppress("DEPRECATION")
  fun fromPackage(context: Context, packageName: String): String? = try {
    val signatures = if (Build.VERSION.SDK_INT >= 28) {
      val signingInfo = context.packageManager
        .getPackageInfo(packageName, PackageManager.GET_SIGNING_CERTIFICATES)
        .signingInfo ?: return null
      signingInfo.apkContentsSigners.toList()
    } else {
      context.packageManager
        .getPackageInfo(packageName, PackageManager.GET_SIGNATURES)
        .signatures
        ?.toList()
        .orEmpty()
    }
    identity(signatures)
  } catch (_: Exception) {
    null
  }

  internal fun identity(signatures: Collection<Signature>): String? {
    if (signatures.isEmpty()) return null
    val digests = signatures.map { signature ->
      MessageDigest.getInstance("SHA-256")
        .digest(signature.toByteArray())
        .joinToString("") { "%02x".format(it) }
    }.sorted()
    return digests.joinToString("+")
  }
}

internal object AutofillTrustPolicy {
  fun isTrusted(
    storedPackage: String,
    storedIdentity: String,
    requestedPackage: String,
    requestedIdentity: String,
  ): Boolean = storedPackage == requestedPackage && storedIdentity == requestedIdentity
}
