import { useEffect, useState } from "react";

import { MobileCommandError } from "../../lib/mobile";
import type { VaultSnapshotDto } from "../../types/desktop";
import type { MobileApi, MobileSelectedVaultDto } from "../../types/mobile";
import type { MobileAutofillRequestDto } from "../../types/mobile";
import { MobileAutofillPanel } from "./MobileAutofillPanel";
import { MobileLockedView } from "./MobileLockedView";
import { MobileUnlockedView } from "./MobileUnlockedView";

interface MobileVaultAppProps {
  api: MobileApi;
}
type Phase = "no_selection" | "selected_locked" | "unlocking" | "unlocked";

export function MobileVaultApp({ api }: MobileVaultAppProps) {
  const [phase, setPhase] = useState<Phase>("no_selection");
  const [selected, setSelected] = useState<MobileSelectedVaultDto | null>(null);
  const [password, setPassword] = useState("");
  const [snapshot, setSnapshot] = useState<VaultSnapshotDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hidden, setHidden] = useState(document.hidden);
  const [autofillRequest, setAutofillRequest] =
    useState<MobileAutofillRequestDto | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .getAutofillRequest()
      .then((launch) => {
        if (!active || launch === null) return;
        setAutofillRequest(launch.request);
        if (launch.selectedVault !== null) {
          setSelected(launch.selectedVault);
          setPhase("selected_locked");
          return;
        }
        return api
          .getVaultSnapshot()
          .then((current) => {
            if (!active) return;
            setSnapshot(current);
            setPhase("unlocked");
          })
          .catch(() => {
            // A locked provider without a remembered source remains a valid state.
          });
      })
      .catch(() => {
        // Normal launcher starts have no Android credential request.
      });
    return () => {
      active = false;
    };
  }, [api]);

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
      setError("Could not open the Android document picker.");
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

  const resetLocked = () => {
    setPassword("");
    setSelected(null);
    setSnapshot(null);
    setError(null);
    setAutofillRequest(null);
    setPhase("no_selection");
  };

  if (phase === "unlocked" && snapshot !== null && autofillRequest !== null) {
    return <MobileAutofillPanel api={api} request={autofillRequest} />;
  }

  if (phase === "unlocked" && snapshot !== null && selected !== null) {
    return (
      <MobileUnlockedView
        api={api}
        selected={selected}
        initialSnapshot={snapshot}
        hidden={hidden}
        onLocked={resetLocked}
      />
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
