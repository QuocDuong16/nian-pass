import { useEffect, useState } from "react";

import { DesktopCommandError, type DesktopApi } from "../../lib/desktop";
import type { VaultSnapshotDto } from "../../types/desktop";

export type SaveIntent = "save" | "lock" | "close";

export type SaveFlowState =
  | { kind: "closed" }
  | { kind: "credential"; intent: SaveIntent; error: string | null }
  | { kind: "saving"; intent: SaveIntent }
  | { kind: "external_conflict" }
  | { kind: "reload_credential"; error: string | null }
  | { kind: "reloading" };

interface SaveFlowOptions {
  api: DesktopApi;
  dirty: boolean;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
  onReloaded: (snapshot: VaultSnapshotDto) => void;
  onSaveBegin: () => void;
  onSaved: (intent: SaveIntent) => Promise<void>;
}

export function useSaveFlow({
  api,
  dirty,
  onSnapshot,
  onReloaded,
  onSaveBegin,
  onSaved,
}: SaveFlowOptions) {
  const [flow, setFlow] = useState<SaveFlowState>({ kind: "closed" });
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    if (status !== "saved") return;
    const timer = setTimeout(() => {
      setStatus("idle");
    }, 4_000);
    return () => {
      clearTimeout(timer);
    };
  }, [status]);

  const start = (intent: SaveIntent) => {
    if (flow.kind !== "closed" || (intent === "save" && !dirty)) return;
    setPassword("");
    setFlow({ kind: "credential", intent, error: null });
  };

  const cancel = () => {
    setPassword("");
    setFlow({ kind: "closed" });
    setStatus("idle");
  };

  const submitSave = async () => {
    if (flow.kind !== "credential" || password === "") return;
    const intent = flow.intent;
    const suppliedPassword = password;
    setPassword("");
    setFlow({ kind: "saving", intent });
    setStatus("saving");
    onSaveBegin();
    try {
      const snapshot = await api.saveVault(suppliedPassword);
      onSnapshot(snapshot);
      setFlow({ kind: "closed" });
      setStatus("saved");
      await onSaved(intent);
    } catch (error) {
      setStatus("idle");
      if (
        error instanceof DesktopCommandError &&
        error.code === "external_change"
      ) {
        setFlow({ kind: "external_conflict" });
        return;
      }
      if (
        error instanceof DesktopCommandError &&
        error.code === "save_uncertain"
      ) {
        try {
          onSnapshot(await api.getVaultSnapshot());
        } catch {
          // The stable save error remains authoritative when refresh also fails.
        }
        setFlow({
          kind: "credential",
          intent,
          error:
            "The vault may have been written, but Nian Pass could not verify the final on-disk state. Your unlocked session remains available. Review the vault before trying again.",
        });
        return;
      }
      const authenticationFailed =
        error instanceof DesktopCommandError &&
        error.code === "save_authentication_failed";
      setFlow({
        kind: "credential",
        intent,
        error: authenticationFailed
          ? "Could not save the vault. Check the master password and try again."
          : "Could not save the vault. Your in-memory changes are still available.",
      });
    }
  };

  const beginReload = () => {
    if (flow.kind !== "external_conflict") return;
    setPassword("");
    setFlow({ kind: "reload_credential", error: null });
  };

  const cancelReload = () => {
    setPassword("");
    setFlow({ kind: "external_conflict" });
  };

  const submitReload = async () => {
    if (flow.kind !== "reload_credential" || password === "") return;
    const suppliedPassword = password;
    setPassword("");
    setFlow({ kind: "reloading" });
    try {
      const snapshot = await api.reloadVault(suppliedPassword);
      onReloaded(snapshot);
      setFlow({ kind: "closed" });
      setStatus("idle");
    } catch {
      setFlow({
        kind: "reload_credential",
        error:
          "The current file could not be reopened. Your in-memory changes are still available.",
      });
    }
  };

  return {
    flow,
    password,
    setPassword,
    status: flow.kind === "saving" ? "saving" : dirty ? "idle" : status,
    saving: flow.kind === "saving",
    busy: flow.kind === "saving" || flow.kind === "reloading",
    start,
    cancel,
    submitSave,
    beginReload,
    cancelReload,
    submitReload,
  };
}
