import { useEffect, useState } from "react";

import { MobileCommandError } from "../../lib/mobile";
import type { VaultSnapshotDto } from "../../types/desktop";
import type { MobileApi } from "../../types/mobile";

export type MobileSaveFlow =
  | { kind: "closed" }
  | { kind: "credential"; intent: "save" | "lock"; error: string | null }
  | { kind: "saving"; intent: "save" | "lock" }
  | { kind: "external_conflict" }
  | { kind: "reload_credential"; error: string | null }
  | { kind: "reloading" }
  | { kind: "uncertain" }
  | { kind: "recovery_required" };

interface Options {
  api: MobileApi;
  dirty: boolean;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
  onLocked: () => void;
  onLockFailure: () => void;
}

export function useMobileSaveFlow(options: Options) {
  const [flow, setFlow] = useState<MobileSaveFlow>({ kind: "closed" });
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(
    () => () => {
      setPassword("");
    },
    [],
  );
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => {
      setSaved(false);
    }, 4_000);
    return () => {
      clearTimeout(timer);
    };
  }, [saved]);

  const start = (intent: "save" | "lock") => {
    if (flow.kind !== "closed" || !options.dirty) return;
    setPassword("");
    setSaved(false);
    setFlow({ kind: "credential", intent, error: null });
  };

  const cancel = () => {
    setPassword("");
    setFlow({ kind: "closed" });
  };

  const submitSave = async () => {
    if (flow.kind !== "credential" || password === "") return;
    const intent = flow.intent;
    const credential = password;
    setPassword("");
    setFlow({ kind: "saving", intent });
    try {
      const snapshot = await options.api.saveVault(credential);
      options.onSnapshot(snapshot);
      if (snapshot.dirty) {
        setFlow({ kind: "uncertain" });
        return;
      }
      setSaved(true);
      setFlow({ kind: "closed" });
      if (intent === "lock") {
        try {
          await options.api.lockVault();
          options.onLocked();
        } catch {
          options.onLockFailure();
        }
      }
    } catch (error) {
      setSaved(false);
      if (
        error instanceof MobileCommandError &&
        error.code === "external_change"
      ) {
        setFlow({ kind: "external_conflict" });
      } else if (
        error instanceof MobileCommandError &&
        error.code === "save_uncertain"
      ) {
        try {
          options.onSnapshot(await options.api.getVaultSnapshot());
        } catch {
          /* stable error wins */
        }
        setFlow({ kind: "uncertain" });
      } else if (
        error instanceof MobileCommandError &&
        error.code === "recovery_required"
      ) {
        setFlow({ kind: "recovery_required" });
      } else {
        const authentication =
          error instanceof MobileCommandError &&
          error.code === "save_authentication_failed";
        setFlow({
          kind: "credential",
          intent,
          error: authentication
            ? "The master password did not authenticate the current provider generation."
            : "Save failed before Nian Pass could prove a verified commit. Local changes remain open.",
        });
      }
    }
  };

  const beginReload = () => {
    if (flow.kind !== "external_conflict") return;
    setPassword("");
    setFlow({ kind: "reload_credential", error: null });
  };

  const submitReload = async () => {
    if (flow.kind !== "reload_credential" || password === "") return;
    const credential = password;
    setPassword("");
    setFlow({ kind: "reloading" });
    try {
      options.onSnapshot(await options.api.reloadVault(credential));
      setFlow({ kind: "closed" });
    } catch (error) {
      if (
        error instanceof MobileCommandError &&
        error.code === "recovery_required"
      ) {
        setFlow({ kind: "recovery_required" });
      } else {
        setFlow({
          kind: "reload_credential",
          error:
            "Reload could not be authenticated and verified. Local changes remain open.",
        });
      }
    }
  };

  return {
    flow,
    password,
    setPassword,
    saved,
    busy: flow.kind === "saving" || flow.kind === "reloading",
    blocked: flow.kind === "recovery_required",
    start,
    cancel,
    submitSave,
    beginReload,
    submitReload,
    cancelReload: () => {
      setFlow({ kind: "external_conflict" });
    },
    dismissUncertain: () => {
      setFlow({ kind: "closed" });
    },
  };
}
