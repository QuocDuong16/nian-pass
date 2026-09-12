import { useEffect, useRef, useState } from "react";

import { DirtyExitDialog } from "./features/vault/DirtyExitDialog";
import { LockedView } from "./features/vault/LockedView";
import {
  SecurityShield,
  type SecurityAttention,
} from "./features/vault/SecurityShield";
import { SaveDialogs } from "./features/vault/SaveDialogs";
import { UnlockedView } from "./features/vault/UnlockedView";
import {
  DEFAULT_AUTO_LOCK_MS,
  useIdleSecurity,
} from "./features/vault/useIdleSecurity";
import { type SaveIntent, useSaveFlow } from "./features/vault/useSaveFlow";
import { useCloseRequest } from "./features/vault/useCloseRequest";
import { useVaultLock } from "./features/vault/useVaultLock";
import { desktopApi, type DesktopApi } from "./lib/desktop";
import type { DesktopWindowLifecycle } from "./lib/window-lifecycle";
import type { VaultSnapshotDto } from "./types/desktop";

interface AppProps {
  api?: DesktopApi;
  windowLifecycle?: DesktopWindowLifecycle | null;
}

type ExitIntent = Extract<SaveIntent, "lock" | "close">;

export default function App({
  api = desktopApi,
  windowLifecycle = null,
}: AppProps) {
  const [snapshot, setSnapshot] = useState<VaultSnapshotDto | null>(null);
  const [vaultViewVersion, setVaultViewVersion] = useState(0);
  const [exitIntent, setExitIntent] = useState<ExitIntent | null>(null);
  const [attention, setAttention] = useState<SecurityAttention | null>(null);
  const [autoLockMs, setAutoLockMs] = useState<number | null>(
    DEFAULT_AUTO_LOCK_MS,
  );
  const [hasLocalDraft, setHasLocalDraft] = useState(false);
  const [mutationPending, setMutationPending] = useState(false);
  const [revealClearVersion, setRevealClearVersion] = useState(0);
  const securityActivity = useRef<() => void>(() => undefined);
  const { locking, lockError, setLockError, performLock } = useVaultLock({
    api,
    windowLifecycle,
    onLocked: (result) => {
      setLockError(
        result.clipboard === "clear_failed"
          ? "Vault locked, but Nian Pass could not clear the clipboard."
          : null,
      );
      setSnapshot(null);
      setAttention(null);
      setExitIntent(null);
      setHasLocalDraft(false);
      setMutationPending(false);
    },
    onUnsaved: (origin) => {
      if (origin === "idle") setAttention({ kind: "dirty" });
      else setExitIntent("lock");
    },
    onIdleFailure: () => {
      setAttention({ kind: "lock_error" });
    },
  });
  const save = useSaveFlow({
    api,
    dirty: snapshot?.dirty ?? false,
    onSnapshot: setSnapshot,
    onReloaded: (nextSnapshot) => {
      setVaultViewVersion((value) => value + 1);
      setSnapshot(nextSnapshot);
    },
    onSaveBegin: () => {
      setVaultViewVersion((value) => value + 1);
    },
    onSaved: async (intent) => {
      if (intent === "save") {
        setAttention(null);
        securityActivity.current();
      } else {
        await performLock(
          false,
          intent === "close",
          intent === "idle_lock" ? "idle" : "manual",
        );
      }
    },
  });
  const clearSavePassword = save.clearPassword;

  const operationPending = locking || save.busy || mutationPending;
  const closeBlocked =
    locking || mutationPending || save.flow.kind !== "closed";
  const idle = useIdleSecurity({
    unlocked: snapshot !== null,
    timeoutMs: autoLockMs,
    blocked: operationPending,
    paused: attention !== null,
    windowLifecycle,
    onExpired: () => {
      setRevealClearVersion((value) => value + 1);
      if (save.flow.kind !== "closed") save.cancel();
      if (hasLocalDraft) setAttention({ kind: "draft", reason: "idle" });
      else if (snapshot?.dirty === true) setAttention({ kind: "dirty" });
      else {
        setAttention({ kind: "locking" });
        void performLock(false, false, "idle");
      }
    },
  });
  useEffect(() => {
    securityActivity.current = idle.recordActivity;
  }, [idle.recordActivity]);

  useEffect(() => {
    clearSavePassword();
  }, [clearSavePassword, idle.privacyVersion]);
  useCloseRequest({
    api,
    windowLifecycle,
    blocked: closeBlocked,
    hasLocalDraft,
    onDraft: () => {
      setAttention({ kind: "draft", reason: "close" });
    },
    onDirty: () => {
      setExitIntent("close");
    },
    onError: () => {
      setLockError("Nian Pass could not verify whether it is safe to close.");
    },
  });

  if (snapshot === null) {
    return (
      <LockedView
        api={api}
        notice={lockError}
        onUnlocked={(nextSnapshot) => {
          setLockError(null);
          setSnapshot(nextSnapshot);
        }}
      />
    );
  }

  const continueEditing = () => {
    setAttention(null);
    setLockError(null);
    idle.recordActivity();
  };
  const discardDraft = () => {
    if (attention?.kind !== "draft" || operationPending) return;
    const reason = attention.reason;
    setVaultViewVersion((value) => value + 1);
    setHasLocalDraft(false);
    setAttention(null);
    if (snapshot.dirty) {
      if (reason === "idle") setAttention({ kind: "dirty" });
      else setExitIntent(reason === "close" ? "close" : "lock");
    } else {
      void performLock(
        false,
        reason === "close",
        reason === "idle" ? "idle" : "manual",
      );
    }
  };
  const shielded =
    idle.backgrounded || attention !== null || idle.expiryPending;

  return (
    <>
      <div hidden={shielded} aria-hidden={shielded}>
        <UnlockedView
          key={vaultViewVersion}
          api={api}
          snapshot={snapshot}
          disabled={locking || save.busy}
          saveStatus={save.status}
          lockError={lockError}
          autoLockMs={autoLockMs}
          clearRevealsVersion={idle.privacyVersion + revealClearVersion}
          onAutoLockChange={setAutoLockMs}
          onDraftStateChange={setHasLocalDraft}
          onMutationPendingChange={setMutationPending}
          onSnapshot={setSnapshot}
          onSave={() => {
            save.start("save");
          }}
          onLock={() => {
            if (mutationPending) return;
            if (hasLocalDraft)
              setAttention({ kind: "draft", reason: "manual" });
            else if (snapshot.dirty) setExitIntent("lock");
            else void performLock(false, false, "manual");
          }}
        />
      </div>
      {shielded ? (
        <SecurityShield
          attention={attention}
          backgrounded={idle.backgrounded}
          expiryPending={idle.expiryPending}
          operationPending={operationPending}
          onContinue={continueEditing}
          onDiscardDraft={discardDraft}
          onSaveAndLock={() => {
            save.start("idle_lock");
          }}
          onDiscardAndLock={() => void performLock(true, false, "idle")}
          onRetryLock={() => void performLock(false, false, "idle")}
        />
      ) : null}
      {exitIntent === null || idle.backgrounded ? null : (
        <DirtyExitDialog
          intent={exitIntent}
          busy={locking}
          onCancel={() => {
            setExitIntent(null);
          }}
          onSave={() => {
            const intent = exitIntent;
            setExitIntent(null);
            save.start(intent);
          }}
          onDiscard={() =>
            void performLock(true, exitIntent === "close", "manual")
          }
        />
      )}
      {idle.backgrounded ? null : (
        <SaveDialogs
          flow={save.flow}
          password={save.password}
          onPassword={save.setPassword}
          onCancel={save.cancel}
          onRetrySave={save.retrySave}
          onReloadChoice={save.beginReload}
          onReloadCancel={save.cancelReload}
          onReload={() => void save.submitReload()}
        />
      )}
    </>
  );
}
