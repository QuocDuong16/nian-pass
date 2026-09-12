import { useState, type SyntheticEvent } from "react";

import type { DesktopApi } from "../../lib/desktop";
import type { SelectedVaultDto, VaultSnapshotDto } from "../../types/desktop";
import { LockedCreateForm } from "./LockedCreateForm";
import { lockedErrorCode, lockedOperationMessage } from "./locked-errors";

interface LockedViewProps {
  api: DesktopApi;
  notice?: string | null;
  onUnlocked: (snapshot: VaultSnapshotDto) => void;
}

type LockedState =
  | { kind: "home" }
  | { kind: "credential_required"; selection: SelectedVaultDto }
  | { kind: "creating" };

export function LockedView({ api, notice, onUnlocked }: LockedViewProps) {
  const [state, setState] = useState<LockedState>({ kind: "home" });
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [vaultName, setVaultName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resetSensitiveFields = () => {
    setPassword("");
    setConfirmPassword("");
  };

  const goHome = () => {
    if (busy) return;
    resetSensitiveFields();
    setVaultName("");
    setError(null);
    setState({ kind: "home" });
  };

  const chooseVault = async () => {
    if (busy) return;
    setError(null);
    try {
      const selected = await api.selectVault();
      if (selected !== null) {
        resetSensitiveFields();
        setState({ kind: "credential_required", selection: selected });
      }
    } catch (cause: unknown) {
      setError(lockedOperationMessage(lockedErrorCode(cause)));
    }
  };

  const submitUnlock = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (state.kind !== "credential_required" || password === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const snapshot = await api.unlockVault(password);
      resetSensitiveFields();
      onUnlocked(snapshot);
    } catch (cause: unknown) {
      setPassword("");
      setError(lockedOperationMessage(lockedErrorCode(cause)));
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = vaultName.trim();
    if (state.kind !== "creating" || busy) return;
    if (name === "") {
      setError("Enter a vault name.");
      return;
    }
    if (password === "") {
      setError("Master password cannot be empty.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Master password confirmation does not match.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const snapshot = await api.createVault(name, password);
      if (snapshot !== null) {
        resetSensitiveFields();
        setVaultName("");
        onUnlocked(snapshot);
      }
    } catch (cause: unknown) {
      resetSensitiveFields();
      setError(lockedOperationMessage(lockedErrorCode(cause)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="locked-view">
      <section className="unlock-card" aria-labelledby="unlock-title">
        <div className="brand-mark" aria-hidden="true">
          N
        </div>
        <p className="eyebrow">Nian Pass</p>
        <h1 id="unlock-title">
          {state.kind === "home"
            ? "Your vaults"
            : state.kind === "creating"
              ? "Create new vault"
              : "Unlock vault"}
        </h1>

        {notice === undefined || notice === null ? null : (
          <p className="lock-notice" role="status">
            {notice}
          </p>
        )}

        {state.kind === "home" ? (
          <div className="locked-home-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => {
                setError(null);
                setState({ kind: "creating" });
              }}
            >
              Create new vault
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => void chooseVault()}
            >
              Open existing vault
            </button>
          </div>
        ) : null}

        {state.kind === "credential_required" ? (
          <form
            onSubmit={(event) => void submitUnlock(event)}
            onKeyDown={(event) => {
              if (event.key === "Escape") goHome();
            }}
          >
            <p className="selected-file">{state.selection.fileName}</p>
            <label htmlFor="master-password">Master password</label>
            <input
              id="master-password"
              name="master-password"
              type="password"
              autoComplete="current-password"
              spellCheck={false}
              value={password}
              autoFocus
              onChange={(event) => {
                setPassword(event.target.value);
              }}
              disabled={busy}
            />
            <div className="dialog-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => void chooseVault()}
              >
                Choose another vault
              </button>
              <button
                className="primary-button"
                type="submit"
                disabled={password === "" || busy}
              >
                {busy ? "Unlocking…" : "Unlock"}
              </button>
            </div>
          </form>
        ) : null}

        {state.kind === "creating" ? (
          <LockedCreateForm
            vaultName={vaultName}
            password={password}
            confirmPassword={confirmPassword}
            busy={busy}
            onVaultName={setVaultName}
            onPassword={setPassword}
            onConfirmPassword={setConfirmPassword}
            onSubmit={(event) => void submitCreate(event)}
            onCancel={goHome}
          />
        ) : null}

        <p className="form-error" role="alert" aria-live="assertive">
          {error ?? ""}
        </p>
      </section>
    </main>
  );
}
