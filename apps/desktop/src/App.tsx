import { useEffect, useRef, useState } from "react";

import { DirtyExitDialog } from "./features/vault/DirtyExitDialog";
import { LockedView } from "./features/vault/LockedView";
import { SaveDialogs } from "./features/vault/SaveDialogs";
import { UnlockedView } from "./features/vault/UnlockedView";
import { type SaveIntent, useSaveFlow } from "./features/vault/useSaveFlow";
import {
  DesktopCommandError,
  desktopApi,
  type DesktopApi,
} from "./lib/desktop";
import type { DesktopWindowLifecycle } from "./lib/window-lifecycle";
import type { LockResultDto, VaultSnapshotDto } from "./types/desktop";

interface AppProps {
  api?: DesktopApi;
  windowLifecycle?: DesktopWindowLifecycle | null;
}

type ExitIntent = Exclude<SaveIntent, "save">;

export default function App({
  api = desktopApi,
  windowLifecycle = null,
}: AppProps) {
  const [snapshot, setSnapshot] = useState<VaultSnapshotDto | null>(null);
  const [vaultViewVersion, setVaultViewVersion] = useState(0);
  const [locking, setLocking] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [exitIntent, setExitIntent] = useState<ExitIntent | null>(null);
  const closeBlocked = useRef(false);

  const finishLocked = (clipboard: string) => {
    if (clipboard === "clear_failed") {
      setLockError(
        "Vault locked, but Nian Pass could not clear the clipboard.",
      );
    }
    setSnapshot(null);
  };

  const performLock = async (discard: boolean, closing: boolean) => {
    if (locking) return;
    closeBlocked.current = true;
    setLocking(true);
    setLockError(null);
    let result: LockResultDto;
    try {
      result = discard
        ? await api.discardChangesAndLock()
        : await api.lockVault();
    } catch (error) {
      if (
        !discard &&
        error instanceof DesktopCommandError &&
        error.code === "unsaved_changes"
      ) {
        setExitIntent("lock");
      } else {
        setLockError(
          "Nian Pass could not lock the vault. The unlocked session remains active.",
        );
      }
      setLocking(false);
      closeBlocked.current = false;
      return;
    }

    finishLocked(result.clipboard);
    setExitIntent(null);
    if (closing && windowLifecycle !== null) {
      try {
        await windowLifecycle.requestClose();
      } catch {
        setLockError("Vault locked, but Nian Pass could not close the window.");
      }
    }
    setLocking(false);
    closeBlocked.current = false;
  };

  const save = useSaveFlow({
    api,
    dirty: snapshot?.dirty ?? false,
    onSnapshot: setSnapshot,
    onReloaded: (nextSnapshot) => {
      setVaultViewVersion((value) => value + 1);
      setSnapshot(nextSnapshot);
    },
    onSaveBegin: () => {
      closeBlocked.current = true;
      setVaultViewVersion((value) => value + 1);
    },
    onSaved: async (intent) => {
      if (intent !== "save") await performLock(false, intent === "close");
    },
  });

  useEffect(() => {
    closeBlocked.current = locking || save.flow.kind !== "closed";
  }, [locking, save.flow.kind]);

  useEffect(() => {
    if (windowLifecycle === null) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    void windowLifecycle
      .onCloseRequested(async (event) => {
        if (closeBlocked.current) {
          event.preventDefault();
          return;
        }
        try {
          const policy = await api.closePolicy();
          if (policy.policy === "confirm_discard") {
            event.preventDefault();
            if (active) setExitIntent("close");
          }
        } catch {
          event.preventDefault();
          if (active) {
            setLockError(
              "Nian Pass could not verify whether it is safe to close.",
            );
          }
        }
      })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [api, windowLifecycle]);

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

  const startExitSave = () => {
    if (exitIntent === null) return;
    const intent = exitIntent;
    setExitIntent(null);
    save.start(intent);
  };

  return (
    <>
      <UnlockedView
        key={vaultViewVersion}
        api={api}
        snapshot={snapshot}
        disabled={locking || save.busy}
        saveStatus={save.status}
        lockError={lockError}
        onSnapshot={setSnapshot}
        onSave={() => {
          save.start("save");
        }}
        onLock={() => {
          if (snapshot.dirty) setExitIntent("lock");
          else void performLock(false, false);
        }}
      />
      {exitIntent === null ? null : (
        <DirtyExitDialog
          intent={exitIntent}
          busy={locking}
          onCancel={() => {
            setExitIntent(null);
          }}
          onSave={startExitSave}
          onDiscard={() => void performLock(true, exitIntent === "close")}
        />
      )}
      <SaveDialogs
        flow={save.flow}
        password={save.password}
        onPassword={save.setPassword}
        onCancel={save.cancel}
        onSave={() => void save.submitSave()}
        onReloadChoice={save.beginReload}
        onReloadCancel={save.cancelReload}
        onReload={() => void save.submitReload()}
      />
    </>
  );
}
