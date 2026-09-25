import { useState, type SyntheticEvent } from "react";

import type { DesktopApi } from "../../lib/desktop";
import type {
  SelectedKeyfileDto,
  SelectedVaultDto,
  VaultSnapshotDto,
} from "../../types/desktop";
import { LockedCreateForm } from "./LockedCreateForm";
import { LockedUnlockForm } from "./LockedUnlockForm";
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
  const [keyfile, setKeyfile] = useState<SelectedKeyfileDto | null>(null);
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
    if (keyfile !== null) void api.clearKeyfile().catch(() => undefined);
    setKeyfile(null);
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
        setKeyfile(null);
        setState({ kind: "credential_required", selection: selected });
      }
    } catch (cause: unknown) {
      setError(lockedOperationMessage(lockedErrorCode(cause)));
    }
  };

  const chooseKeyfile = async () => {
    if (busy || state.kind !== "credential_required") return;
    setError(null);
    try {
      const selected = await api.selectKeyfile();
      if (selected !== null) setKeyfile(selected);
    } catch (cause: unknown) {
      setError(lockedOperationMessage(lockedErrorCode(cause)));
    }
  };

  const removeKeyfile = async () => {
    if (busy || keyfile === null) return;
    setError(null);
    try {
      await api.clearKeyfile();
      setKeyfile(null);
    } catch (cause: unknown) {
      setError(lockedOperationMessage(lockedErrorCode(cause)));
    }
  };

  const submitUnlock = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      state.kind !== "credential_required" ||
      (password === "" && keyfile === null) ||
      busy
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const snapshot =
        keyfile === null
          ? await api.unlockVault(password)
          : await api.unlockVaultWithKeyfile(password === "" ? null : password);
      resetSensitiveFields();
      setKeyfile(null);
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
      const code = lockedErrorCode(cause);
      setError(
        code === "unsupported_persistence_platform"
          ? "Creating and editing vaults is unavailable on Windows until safe file saving is verified. No file was created. You can still open existing vaults read-only."
          : lockedOperationMessage(code),
      );
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
              ? "Create a vault"
              : "Unlock vault"}
        </h1>

        <p className="unlock-intro">
          {state.kind === "home"
            ? "Open an existing KeePass database or create a local vault where safe saving is supported."
            : state.kind === "creating"
              ? "Choose a name and master password. Nian Pass opens the save dialog only where safe vault saving is supported."
              : "Enter the master password and, when required, choose the vault key file."}
        </p>

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
              onClick={() => void chooseVault()}
            >
              Open existing vault
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setError(null);
                setState({ kind: "creating" });
              }}
            >
              Create new vault
            </button>
          </div>
        ) : null}

        {state.kind === "credential_required" ? (
          <LockedUnlockForm
            selection={state.selection}
            password={password}
            keyfile={keyfile}
            busy={busy}
            onPassword={setPassword}
            onChooseKeyfile={() => void chooseKeyfile()}
            onRemoveKeyfile={() => void removeKeyfile()}
            onChooseVault={() => void chooseVault()}
            onCancel={goHome}
            onSubmit={(event) => void submitUnlock(event)}
          />
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
