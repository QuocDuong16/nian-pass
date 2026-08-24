import { useState } from "react";

import { LockedView } from "./features/vault/LockedView";
import { UnlockedView } from "./features/vault/UnlockedView";
import { desktopApi, type DesktopApi } from "./lib/desktop";
import type { VaultSnapshotDto } from "./types/desktop";

interface AppProps {
  api?: DesktopApi;
}

export default function App({ api = desktopApi }: AppProps) {
  const [snapshot, setSnapshot] = useState<VaultSnapshotDto | null>(null);
  const [locking, setLocking] = useState(false);
  const [lockError, setLockError] = useState<string | null>(null);

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

  const lock = async () => {
    if (locking) {
      return;
    }
    setLocking(true);
    setLockError(null);
    try {
      const result = await api.lockVault();
      if (result.clipboard === "clear_failed") {
        setLockError(
          "Vault locked, but Nian Pass could not clear the clipboard.",
        );
      }
      setSnapshot(null);
    } catch {
      setLockError(
        "Nian Pass could not lock the vault. Close the application to drop the session.",
      );
    } finally {
      setLocking(false);
    }
  };

  return (
    <UnlockedView
      api={api}
      snapshot={snapshot}
      locking={locking}
      lockError={lockError}
      onLock={lock}
    />
  );
}
