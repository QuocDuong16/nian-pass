import { useCallback, useEffect, useRef, useState } from "react";

import { MobileCommandError } from "../../lib/mobile";
import type { VaultSnapshotDto } from "../../types/desktop";
import type { MobileApi, MobileSelectedVaultDto } from "../../types/mobile";
import type { RuntimePlatform } from "../../types/runtime";
import { MobileAutofillPanel } from "./MobileAutofillPanel";
import { MobileLockedView } from "./MobileLockedView";
import { MobileTransitionShield } from "./MobileTransitionShield";
import { MobileUnlockedView } from "./MobileUnlockedView";
import { useAcknowledgeLockedMobileUi } from "./useAcknowledgeLockedMobileUi";
import { useMobileAutofillLaunch } from "./useMobileAutofillLaunch";
import { DEFAULT_MOBILE_AUTO_LOCK_MS } from "./useMobileIdleSecurity";
import { useMobileSecurityLifecycle } from "./useMobileSecurityLifecycle";

interface MobileVaultAppProps {
  api: MobileApi;
  platform?: Extract<RuntimePlatform, "android" | "ios">;
}
type Phase = "no_selection" | "selected_locked" | "unlocking" | "unlocked";

export function MobileVaultApp({
  api,
  platform = "android",
}: MobileVaultAppProps) {
  const [phase, setPhase] = useState<Phase>("no_selection");
  const [selected, setSelected] = useState<MobileSelectedVaultDto | null>(null);
  const [password, setPassword] = useState("");
  const [snapshot, setSnapshot] = useState<VaultSnapshotDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(document.hidden);
  const [timeoutMs, setTimeoutMs] = useState<number | null>(
    DEFAULT_MOBILE_AUTO_LOCK_MS,
  );
  const clearFrontendCredentials = useCallback(() => {
    setPassword("");
  }, []);
  const security = useMobileSecurityLifecycle({
    api,
    enabled: platform === "android",
    onSecurityTransition: clearFrontendCredentials,
  });
  const {
    acknowledge: acknowledgeSafeUi,
    boundaryPending,
    refresh: refreshSecurity,
    refreshing: securityRefreshing,
    shielded: securityShielded,
    status: securityStatus,
  } = security;
  const onAutofillSelected = useCallback((next: MobileSelectedVaultDto) => {
    setSelected(next);
    setPhase("selected_locked");
  }, []);
  const onAutofillUnlocked = useCallback((current: VaultSnapshotDto) => {
    setSnapshot(current);
    setPhase("unlocked");
  }, []);
  const { request: autofillRequest, clearRequest: clearAutofillRequest } =
    useMobileAutofillLaunch({
      api,
      enabled: platform === "android",
      onSelected: onAutofillSelected,
      onUnlocked: onAutofillUnlocked,
    });
  const autofillLockGeneration = useRef<number | null>(null);
  const resetLocked = useCallback(() => {
    setPassword("");
    setSelected(null);
    setSnapshot(null);
    setError(null);
    clearAutofillRequest();
    setPhase("no_selection");
  }, [clearAutofillRequest]);

  useEffect(() => {
    const onVisibility = () => {
      setHidden(document.hidden);
      if (document.hidden) setPassword("");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      setPassword("");
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useAcknowledgeLockedMobileUi({
    enabled: platform === "android",
    lockedUi: phase !== "unlocking" && phase !== "unlocked",
    refreshing: securityRefreshing,
    shielded: securityShielded,
    status: securityStatus,
    acknowledge: acknowledgeSafeUi,
  });

  useEffect(() => {
    const status = securityStatus;
    if (
      platform !== "android" ||
      phase !== "unlocked" ||
      autofillRequest === null ||
      !securityShielded ||
      securityRefreshing ||
      status === null ||
      autofillLockGeneration.current === status.generation
    ) {
      return;
    }
    if (status.vaultState === "locked") {
      void Promise.resolve().then(resetLocked);
      return;
    }
    if (!boundaryPending) {
      void acknowledgeSafeUi(status.generation);
      return;
    }
    if (status.operationPending) {
      void refreshSecurity();
      return;
    }
    autofillLockGeneration.current = status.generation;
    void api
      .lockVault()
      .then(resetLocked)
      .catch(() => {
        setError("Nian Pass could not safely lock the credential session.");
      });
  }, [
    api,
    acknowledgeSafeUi,
    autofillRequest,
    boundaryPending,
    phase,
    platform,
    refreshSecurity,
    resetLocked,
    securityRefreshing,
    securityShielded,
    securityStatus,
  ]);

  const choose = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await api.selectVault();
      if (next !== null) {
        setSelected(next);
        setPassword("");
        setSnapshot(null);
        setPhase("selected_locked");
      }
    } catch {
      setError(
        `Could not open the ${platform === "ios" ? "iOS" : "Android"} document picker.`,
      );
    } finally {
      setBusy(false);
    }
  };

  const unlock = async () => {
    if (busy || password === "") return;
    const credential = password;
    setPassword("");
    setBusy(true);
    setError(null);
    setPhase("unlocking");
    try {
      setSnapshot(await api.unlockVault(credential));
      setPhase("unlocked");
    } catch (failure) {
      setPhase("selected_locked");
      setError(
        failure instanceof MobileCommandError &&
          failure.code === "recovery_required"
          ? "This vault has an unfinished save operation. Nian Pass cannot safely continue until the source is reconciled."
          : "Could not unlock this vault. Check the password or choose another vault.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (phase === "unlocked" && snapshot !== null && autofillRequest !== null) {
    if (platform === "android" && securityShielded) {
      return (
        <MobileTransitionShield
          title="Securing Nian Pass"
          titleId="mobile-secure-title"
        >
          Credential content remains unavailable during this transition.
        </MobileTransitionShield>
      );
    }
    return <MobileAutofillPanel api={api} request={autofillRequest} />;
  }

  if (phase === "unlocked" && snapshot !== null && selected !== null) {
    return (
      <MobileUnlockedView
        api={api}
        selected={selected}
        initialSnapshot={snapshot}
        hidden={platform === "android" ? securityShielded : hidden}
        securityStatus={platform === "android" ? securityStatus : null}
        securityRefreshing={securityRefreshing}
        onAcknowledgeSafeUi={acknowledgeSafeUi}
        onRefreshSecurity={refreshSecurity}
        timeoutMs={timeoutMs}
        onTimeout={setTimeoutMs}
        platform={platform}
        onLocked={resetLocked}
      />
    );
  }

  if (platform === "android" && securityShielded && boundaryPending) {
    return (
      <MobileTransitionShield
        title="Nian Pass locked"
        titleId="mobile-locked-title"
      >
        Sensitive input is unavailable during this transition.
      </MobileTransitionShield>
    );
  }

  return (
    <MobileLockedView
      selected={selected}
      password={password}
      busy={busy}
      unlocking={phase === "unlocking"}
      error={error}
      onPassword={setPassword}
      onChoose={() => void choose()}
      onUnlock={() => void unlock()}
    />
  );
}
