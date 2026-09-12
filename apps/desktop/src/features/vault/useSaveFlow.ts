import { useCallback, useEffect, useState } from "react";

import { DesktopCommandError, type DesktopApi } from "../../lib/desktop";
import type { DesktopErrorCode, VaultSnapshotDto } from "../../types/desktop";

export type SaveIntent = "save" | "lock" | "close" | "idle_lock";

export type SaveFlowState =
  | { kind: "closed" }
  | { kind: "saving"; intent: SaveIntent }
  | { kind: "save_error"; intent: SaveIntent; error: string }
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

function saveFailureMessage(code: DesktopErrorCode): string {
  if (code === "unsupported_write_format") {
    return "This KDBX version is read-only in Nian Pass and cannot be saved.";
  }
  if (code === "unsupported_persistence_platform") {
    return "Nian Pass cannot safely persist vault changes on this platform.";
  }
  if (code === "read_only_source") {
    return "This vault source is read-only. Nian Pass did not overwrite it.";
  }
  if (code === "save_authentication_failed") {
    return "The unlocked session can no longer authenticate this vault for saving. Lock and reopen the vault before editing further.";
  }
  if (code === "operation_in_progress") {
    return "Another vault operation is still running. Try Save again after it finishes.";
  }
  return "Nian Pass could not safely save the vault. Your in-memory changes are still available.";
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

  const runSave = async (intent: SaveIntent) => {
    setFlow({ kind: "saving", intent });
    setStatus("saving");
    onSaveBegin();
    try {
      const snapshot = await api.saveVault();
      onSnapshot(snapshot);
      setFlow({ kind: "closed" });
      setStatus("saved");
      await onSaved(intent);
    } catch (error: unknown) {
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
          kind: "save_error",
          intent,
          error:
            "The vault may have been written, but Nian Pass could not verify the final on-disk state. Review the vault before trying again.",
        });
        return;
      }
      const code =
        error instanceof DesktopCommandError ? error.code : "internal";
      setFlow({ kind: "save_error", intent, error: saveFailureMessage(code) });
    }
  };

  const start = (intent: SaveIntent) => {
    if (flow.kind !== "closed" || (intent === "save" && !dirty)) return;
    setPassword("");
    void runSave(intent);
  };

  const retrySave = () => {
    if (flow.kind !== "save_error") return;
    const intent = flow.intent;
    void runSave(intent);
  };

  const cancel = () => {
    setPassword("");
    setFlow({ kind: "closed" });
    setStatus("idle");
  };

  const clearPassword = useCallback(() => {
    setPassword("");
  }, []);

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
    retrySave,
    cancel,
    clearPassword,
    beginReload,
    cancelReload,
    submitReload,
  };
}
