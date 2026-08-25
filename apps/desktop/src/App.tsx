import { useEffect, useState } from "react";

import { DiscardDialog } from "./features/vault/DiscardDialog";
import { LockedView } from "./features/vault/LockedView";
import { UnlockedView } from "./features/vault/UnlockedView";
import {
  DesktopCommandError,
  desktopApi,
  type DesktopApi,
} from "./lib/desktop";
import type { LockResultDto, VaultSnapshotDto } from "./types/desktop";
import type { DesktopWindowLifecycle } from "./lib/window-lifecycle";

interface AppProps {
  api?: DesktopApi;
  windowLifecycle?: DesktopWindowLifecycle | null;
}

type DiscardIntent = "lock" | "close";

export default function App({
  api = desktopApi,
  windowLifecycle = null,
}: AppProps) {
  const [snapshot, setSnapshot] = useState<VaultSnapshotDto | null>(null);
  const [locking, setLocking] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const [discardIntent, setDiscardIntent] = useState<DiscardIntent | null>(
    null,
  );

  useEffect(() => {
    if (windowLifecycle === null) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    void windowLifecycle
      .onCloseRequested(async (event) => {
        try {
          const policy = await api.closePolicy();
          if (policy.policy === "confirm_discard") {
            event.preventDefault();
            if (active) setDiscardIntent("close");
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

  const finishLocked = (clipboard: string) => {
    if (clipboard === "clear_failed") {
      setLockError(
        "Vault locked, but Nian Pass could not clear the clipboard.",
      );
    }
    setSnapshot(null);
  };

  const lock = async (discard = false) => {
    if (locking) {
      return;
    }
    setLocking(true);
    setLockError(null);
    let result: LockResultDto;
    try {
      result = discard
        ? await api.discardChangesAndLock()
        : await api.lockVault();
    } catch (error) {
      if (
        error instanceof DesktopCommandError &&
        error.code === "unsaved_changes"
      ) {
        setDiscardIntent("lock");
        return;
      }
      setLockError(
        "Nian Pass could not lock the vault. The unlocked session remains active.",
      );
      setLocking(false);
      return;
    }

    const closing = discardIntent === "close" && windowLifecycle !== null;
    finishLocked(result.clipboard);
    setDiscardIntent(null);
    if (closing) {
      try {
        await windowLifecycle.requestClose();
      } catch {
        setLockError("Vault locked, but Nian Pass could not close the window.");
      }
    }
    setLocking(false);
  };

  return (
    <>
      <UnlockedView
        api={api}
        snapshot={snapshot}
        locking={locking}
        lockError={lockError}
        onSnapshot={setSnapshot}
        onLock={() => {
          if (snapshot.dirty) setDiscardIntent("lock");
          else void lock();
        }}
      />
      {discardIntent !== null ? (
        <DiscardDialog
          closing={discardIntent === "close"}
          busy={locking}
          onCancel={() => {
            setDiscardIntent(null);
          }}
          onConfirm={() => void lock(true)}
        />
      ) : null}
    </>
  );
}
