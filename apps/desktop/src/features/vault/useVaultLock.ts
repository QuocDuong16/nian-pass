import { useRef, useState } from "react";

import { DesktopCommandError, type DesktopApi } from "../../lib/desktop";
import type { DesktopWindowLifecycle } from "../../lib/window-lifecycle";
import type { LockResultDto } from "../../types/desktop";

export type LockOrigin = "manual" | "idle";

interface VaultLockOptions {
  api: DesktopApi;
  windowLifecycle: DesktopWindowLifecycle | null;
  onLocked: (result: LockResultDto) => void;
  onUnsaved: (origin: LockOrigin) => void;
  onIdleFailure: () => void;
}

export function useVaultLock({
  api,
  windowLifecycle,
  onLocked,
  onUnsaved,
  onIdleFailure,
}: VaultLockOptions) {
  const [locking, setLocking] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const performLock = async (
    discard: boolean,
    closing: boolean,
    origin: LockOrigin,
  ) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLocking(true);
    setLockError(null);
    try {
      const result = discard
        ? await api.discardChangesAndLock()
        : await api.lockVault();
      onLocked(result);
      if (closing && windowLifecycle !== null) {
        try {
          await windowLifecycle.destroyApprovedWindow();
        } catch {
          setLockError(
            "Vault locked, but Nian Pass could not close the window.",
          );
        }
      }
    } catch (error) {
      if (
        !discard &&
        error instanceof DesktopCommandError &&
        error.code === "unsaved_changes"
      ) {
        onUnsaved(origin);
      } else if (origin === "idle") {
        onIdleFailure();
      } else {
        setLockError(
          "Nian Pass could not lock the vault. The unlocked session remains active.",
        );
      }
    } finally {
      setLocking(false);
      inFlight.current = false;
    }
  };

  return { locking, lockError, setLockError, performLock };
}
