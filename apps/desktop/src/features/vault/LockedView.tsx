import { useState, type SyntheticEvent } from "react";

import { DesktopCommandError, type DesktopApi } from "../../lib/desktop";
import type {
  DesktopErrorCode,
  SelectedVaultDto,
  VaultSnapshotDto,
} from "../../types/desktop";

interface LockedViewProps {
  api: DesktopApi;
  notice?: string | null;
  onUnlocked: (snapshot: VaultSnapshotDto) => void;
}

function unlockMessage(code: DesktopErrorCode): string {
  switch (code) {
    case "unlock_failed":
      return "Could not unlock this vault. Check the password and try again.";
    case "unsupported_vault":
      return "This file is not a supported KDBX vault.";
    case "already_unlocked":
      return "Lock the current vault before opening another one.";
    case "entry_not_found":
    case "secret_unavailable":
    case "clipboard_failed":
    case "locked":
    case "no_vault_selected":
    case "internal":
      return "Nian Pass could not open the vault. Try again.";
  }
}

function errorCode(error: unknown): DesktopErrorCode {
  return error instanceof DesktopCommandError ? error.code : "internal";
}

export function LockedView({ api, notice, onUnlocked }: LockedViewProps) {
  const [selection, setSelection] = useState<SelectedVaultDto | null>(null);
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chooseVault = async () => {
    setError(null);
    try {
      const selected = await api.selectVault();
      if (selected !== null) {
        setSelection(selected);
        setPassword("");
      }
    } catch (cause: unknown) {
      setError(unlockMessage(errorCode(cause)));
    }
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (selection === null || password === "" || unlocking) {
      return;
    }

    setUnlocking(true);
    setError(null);
    try {
      const snapshot = await api.unlockVault(password);
      setPassword("");
      onUnlocked(snapshot);
    } catch (cause: unknown) {
      setPassword("");
      setError(unlockMessage(errorCode(cause)));
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <main className="locked-view">
      <section className="unlock-card" aria-labelledby="unlock-title">
        <div className="brand-mark" aria-hidden="true">
          N
        </div>
        <p className="eyebrow">Nian Pass</p>
        <h1 id="unlock-title">Open your vault</h1>
        <p className="unlock-intro">
          Choose a local KDBX file, then enter its master password.
        </p>

        <button
          className="secondary-button file-button"
          type="button"
          onClick={() => void chooseVault()}
        >
          Choose KDBX file
        </button>
        <p className="selected-file" aria-live="polite">
          {selection === null ? "No vault selected" : selection.fileName}
        </p>
        {notice === undefined || notice === null ? null : (
          <p className="lock-notice" role="status">
            {notice}
          </p>
        )}

        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="master-password">Master password</label>
          <input
            id="master-password"
            name="master-password"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
            }}
            disabled={unlocking}
          />
          <button
            className="primary-button unlock-button"
            type="submit"
            disabled={selection === null || password === "" || unlocking}
          >
            {unlocking ? "Unlocking…" : "Unlock"}
          </button>
        </form>

        <p className="form-error" role="alert" aria-live="assertive">
          {error ?? ""}
        </p>
      </section>
    </main>
  );
}
