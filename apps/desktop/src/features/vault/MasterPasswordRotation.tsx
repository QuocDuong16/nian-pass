import { useEffect, useState, type SyntheticEvent } from "react";

import { Button } from "../../components/Button";
import type { DesktopApi } from "../../lib/desktop";
import {
  removalFailureMessage,
  rotationFailureMessage,
} from "./credential-failure-messages";
import type { VaultSnapshotDto } from "../../types/desktop";

interface MasterPasswordRotationProps {
  api: DesktopApi;
  hasKeyfile?: boolean | null;
  disabled: boolean;
  dirty: boolean;
  onBusyChange: (busy: boolean) => void;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
}

export function MasterPasswordRotation(props: MasterPasswordRotationProps) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [acknowledgedBackup, setAcknowledgedBackup] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [removed, setRemoved] = useState(false);

  useEffect(() => {
    let active = true;
    void props.api.credentialHasPassword().then(
      (present) => {
        if (active) setHasPassword(present);
      },
      () => {
        if (active) setHasPassword(null);
      },
    );
    return () => {
      active = false;
    };
  }, [props.api]);

  const mismatch = confirmation !== "" && password !== confirmation;
  const submitDisabled =
    props.disabled || busy || password === "" || password !== confirmation;

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitDisabled) return;
    setBusy(true);
    props.onBusyChange(true);
    setFailure(null);
    setSucceeded(false);
    setRemoved(false);
    try {
      const snapshot = await props.api.changeMasterPassword(password);
      props.onSnapshot(snapshot);
      setPassword("");
      setConfirmation("");
      setHasPassword(true);
      setSucceeded(true);
    } catch (error: unknown) {
      setFailure(rotationFailureMessage(error));
    } finally {
      setBusy(false);
      props.onBusyChange(false);
    }
  };

  const remove = async () => {
    if (
      props.disabled ||
      busy ||
      props.hasKeyfile !== true ||
      hasPassword !== true ||
      !acknowledgedBackup
    )
      return;
    setBusy(true);
    props.onBusyChange(true);
    setFailure(null);
    setSucceeded(false);
    setRemoved(false);
    try {
      const snapshot = await props.api.removeMasterPassword();
      props.onSnapshot(snapshot);
      setHasPassword(false);
      setPassword("");
      setConfirmation("");
      setRemoved(true);
    } catch (error: unknown) {
      setFailure(removalFailureMessage(error));
      try {
        setHasPassword(await props.api.credentialHasPassword());
      } catch {
        setHasPassword(null);
      }
    } finally {
      setConfirmRemove(false);
      setAcknowledgedBackup(false);
      setBusy(false);
      props.onBusyChange(false);
    }
  };

  return (
    <form
      className="settings-credential-form"
      onSubmit={(event) => void submit(event)}
    >
      <div>
        <strong>Master password</strong>
        <p>
          Add or change the master password by re-encrypting the KDBX. An
          existing keyfile remains part of the credential and never enters the
          WebView.
        </p>
      </div>
      {props.dirty ? (
        <p className="settings-inline-warning">
          Save or discard unsaved vault changes before changing the master
          password.
        </p>
      ) : null}
      {hasPassword === false ? (
        <p className="settings-credential-state">
          This vault currently uses a keyfile without a master password.
        </p>
      ) : null}
      <label htmlFor="settings-new-master-password">New master password</label>
      <input
        id="settings-new-master-password"
        type="password"
        autoComplete="new-password"
        spellCheck={false}
        value={password}
        disabled={props.disabled || busy}
        onChange={(event) => {
          setPassword(event.target.value);
        }}
      />
      <label htmlFor="settings-confirm-master-password">
        Confirm new master password
      </label>
      <input
        id="settings-confirm-master-password"
        type="password"
        autoComplete="new-password"
        spellCheck={false}
        value={confirmation}
        disabled={props.disabled || busy}
        aria-invalid={mismatch || undefined}
        onChange={(event) => {
          setConfirmation(event.target.value);
        }}
      />
      {mismatch ? (
        <p role="alert">The two master passwords do not match.</p>
      ) : null}
      {failure === null ? null : <p role="alert">{failure}</p>}
      {succeeded ? (
        <p role="status">Master password changed and the vault was verified.</p>
      ) : null}
      {removed ? (
        <p role="status">Master password removed. The vault is keyfile-only.</p>
      ) : null}
      <div className="stacked-actions">
        <Button size="sm" type="submit" disabled={submitDisabled}>
          {busy
            ? "Changing…"
            : hasPassword === false
              ? "Add master password"
              : "Change master password"}
        </Button>
        {props.hasKeyfile === true && hasPassword === true ? (
          <Button
            size="sm"
            variant="danger"
            type="button"
            disabled={props.disabled || busy}
            onClick={() => {
              setFailure(null);
              setSucceeded(false);
              setRemoved(false);
              setConfirmRemove(true);
            }}
          >
            Remove master password
          </Button>
        ) : null}
      </div>
      {confirmRemove && props.hasKeyfile === true && hasPassword === true ? (
        <div
          className="settings-inline-confirm"
          role="group"
          aria-label="Remove master password"
        >
          <p>
            This rewrites the encrypted vault as keyfile-only. You must keep a
            separate, accessible copy of the keyfile: without it, the vault
            cannot be reopened. Previous backups may still use the old password
            and keyfile. Manual desktop sync uses the retained keyfile without
            sending its bytes to the WebView.
          </p>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={acknowledgedBackup}
              disabled={props.disabled || busy}
              onChange={(event) => {
                setAcknowledgedBackup(event.currentTarget.checked);
              }}
            />
            I have an accessible backup of the keyfile
          </label>
          <div className="stacked-actions">
            <Button
              size="sm"
              variant="danger"
              type="button"
              disabled={props.disabled || busy || !acknowledgedBackup}
              onClick={() => void remove()}
            >
              {busy ? "Removing…" : "Confirm remove master password"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirmRemove(false);
                setAcknowledgedBackup(false);
              }}
            >
              Keep master password
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
