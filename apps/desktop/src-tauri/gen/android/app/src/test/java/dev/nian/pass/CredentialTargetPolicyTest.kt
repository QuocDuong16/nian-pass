package dev.nian.pass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CredentialTargetPolicyTest {
  @Test
  fun directAppWithoutOriginClassifiesAsApp() {
    val target = CredentialTargetClassifier.classify("dev.example", "cert", false) {
      error("origin verifier must not run")
    }
    assertEquals(TargetKind.APP, target?.kind)
    assertEquals("dev.example", target?.packageName)
  }

  @Test
  fun verifiedBrowserOriginClassifiesAsCanonicalWebHost() {
    val target = CredentialTargetClassifier.classify("com.android.chrome", "cert", true) {
      "https://Example.COM"
    }
    assertEquals(TargetKind.WEB, target?.kind)
    assertEquals("example.com", target?.webDomain)
    assertEquals("com.android.chrome", target?.packageName)
    assertEquals("cert", target?.signingIdentity)
  }

  @Test
  fun populatedOriginVerificationFailureIsRejectedInsteadOfDowngraded() {
    val target = CredentialTargetClassifier.classify("com.android.chrome", "cert", true) {
      throw IllegalStateException("not allowlisted")
    }
    assertNull(target)
  }

  @Test
  fun malformedOrUnsupportedOriginIsRejected() {
    for (origin in listOf(
      "http://example.com",
      "https://user@example.com",
      "https://example.com/path",
      "https://example.com?next=evil",
      "not an origin",
    )) {
      assertNull(CredentialTargetClassifier.classify("browser", "cert", true) { origin })
    }
  }

  @Test
  fun lookalikeHostNeverCanonicalizesToTrustedHost() {
    val expected = WebCredentialOrigin.canonicalHost("https://example.com")
    val lookalike = WebCredentialOrigin.canonicalHost("https://evil-example.com")
    assertTrue(expected != null && lookalike != null)
    assertNotEquals(expected, lookalike)
  }
}
