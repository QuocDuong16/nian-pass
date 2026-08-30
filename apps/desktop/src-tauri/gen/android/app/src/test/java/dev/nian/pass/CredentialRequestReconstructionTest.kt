package dev.nian.pass

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class CredentialRequestReconstructionTest {
  @Test
  fun lifecycleCompletionIsExactlyOnceAndCannotRetireANewerRequest() {
    val gate = CredentialCompletionGate()
    gate.activate("request-a")
    assertFalse(gate.complete("request-b"))
    assertTrue(gate.complete("request-a"))
    assertFalse(gate.complete("request-a"))

    gate.activate("request-b")
    assertEquals("request-b", gate.retire())
    assertEquals(null, gate.retire())
  }

  private val target = CredentialTarget(TargetKind.APP, "dev.example", "cert")

  @Test
  fun emptyRegistryAndCredentialManagerAuthFrameworkRequestIsRecoverable() {
    val authority = FrameworkRequestAuthority(FrameworkRequestKind.CREDENTIAL_AUTH, target)
    assertEquals(
      ReconstructionDisposition.CREATE_FRESH,
      RequestReconstructionPolicy.reconcile(authority, null, null),
    )
  }

  @Test
  fun emptyRegistryAndFinalCredentialFrameworkRequestIsRecoverable() {
    val authority = FrameworkRequestAuthority(
        FrameworkRequestKind.CREDENTIAL_FINAL,
        target,
        selectedEntryId = "opaque-entry-id",
      )
    assertEquals(
      ReconstructionDisposition.CREATE_FRESH,
      RequestReconstructionPolicy.reconcile(authority, null, null),
    )
  }

  @Test
  fun emptyRegistryAndAutofillAssistStructureAuthorityIsRecoverable() {
    val authority = FrameworkRequestAuthority(
      FrameworkRequestKind.AUTOFILL_AUTH,
      target,
      fieldCount = 2,
    )
    assertEquals(
      ReconstructionDisposition.CREATE_FRESH,
      RequestReconstructionPolicy.reconcile(authority, null, null),
    )
  }

  @Test
  fun staleOpaqueTokenWithoutFrameworkAuthorityIsRejected() {
    assertFalse(RequestReconstructionPolicy.isRecoverable(null))
    assertFalse(RequestReconstructionPolicy.isRecoverable(
      FrameworkRequestAuthority(FrameworkRequestKind.CREDENTIAL_FINAL, target),
    ))
    assertEquals(
      ReconstructionDisposition.REJECT,
      RequestReconstructionPolicy.reconcile(null, null, null),
    )
  }

  @Test
  fun onNewIntentPolicyReplacesCurrentRequestAndRejectsRetiredIntent() {
    val uses = PendingIntentUseRegistry(clock = { 1_000L })
    val state = CredentialActivityRequestState(uses)
    val requestA = PendingIntentIdentity.newDataUri()
    val requestB = PendingIntentIdentity.newDataUri()
    assertTrue(state.activate(requestA))
    assertTrue(state.activate(requestB))
    assertEquals(requestB, state.currentIdentity)
    assertFalse(state.activate(requestA))
    assertEquals(requestB, state.currentIdentity)

    state.consumeCurrent()
    assertFalse(CredentialActivityRequestState(uses).activate(requestB))
  }
}
