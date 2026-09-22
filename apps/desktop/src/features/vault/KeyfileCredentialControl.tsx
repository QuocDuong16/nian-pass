import { useEffect, useState } from "react";

import { Button } from "../../components/Button";
import { DesktopCommandError, type DesktopApi } from "../../lib/desktop";

interface KeyfileCredentialControlProps {
  api: DesktopApi;
  disabled: boolean;
  dirty: boolean;
  onBusyChange: (busy: boolean) => void;
  onKeyfileStateChange?: (present: boolean | null) => void;
}

type KeyfileAction = "replace" | "remove";

export function KeyfileCredentialControl(props: KeyfileCredentialControlProps) {
  const [hasKeyfile, setHasKeyfile] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const { api, onKeyfileStateChange } = props;

  useEffect(() => {
    let active = true;
    void api
      .credentialHasKeyfile()
      .then((present) => {
        if (active) {
          setHasKeyfile(present);
          onKeyfileStateChange?.(present);
        }
      })
      .catch(() => {
        if (active) {
          setHasKeyfile(null);
          onKeyfileStateChange?.(null);
          setFailure("Could not read the current keyfile credential state.");
        }
      });
    return () => {
      active = false;
    };
  }, [api, onKeyfileStateChange]);

  const run = async (action: KeyfileAction) => {
    if (props.disabled || busy) return;
    setBusy(true);
    props.onBusyChange(true);
    setFailure(null);
    setStatus(null);
    try {
      if (action === "replace") {
        const receipt = await props.api.replaceKeyfile();
        if (receipt === null) return;
        setHasKeyfile(true);
        props.onKeyfileStateChange?.(true);
        setConfirmRemove(false);
        setStatus(`Keyfile credential updated from ${receipt.fileName}.`);
      } else {
        await props.api.removeKeyfile();
        setHasKeyfile(false);
        props.onKeyfileStateChange?.(false);
        setConfirmRemove(false);
        setStatus(
          "Keyfile removed. The retained master password now protects the vault.",
        );
      }
    } catch (error: unknown) {
      if (action === "remove") setConfirmRemove(false);
      setFailure(keyfileFailureMessage(action, error));
      try {
        const proven = await props.api.credentialHasKeyfile();
        setHasKeyfile(proven);
        props.onKeyfileStateChange?.(proven);
      } catch {
        setHasKeyfile(null);
        props.onKeyfileStateChange?.(null);
      }
    } finally {
      setBusy(false);
      props.onBusyChange(false);
    }
  };

  const controlsDisabled = props.disabled || busy || hasKeyfile === null;

  return (
    <section
      className="settings-credential-form"
      aria-labelledby="keyfile-title"
    >
      <div>
        <strong id="keyfile-title">Keyfile</strong>
        <p>
          Add or replace a keyfile without exposing its bytes or native path to
          the WebView. The current password component stays in Rust and is
          preserved.
        </p>
      </div>
      {props.dirty ? (
        <p className="settings-inline-warning">
          Save or discard unsaved vault changes before changing the keyfile.
        </p>
      ) : null}
      <p className="settings-credential-state">
        {hasKeyfile === null
          ? "Checking keyfile state…"
          : hasKeyfile
            ? "A keyfile is part of the current vault credential."
            : "No keyfile is part of the current vault credential."}
      </p>
      {failure === null ? null : <p role="alert">{failure}</p>}
      {status === null ? null : <p role="status">{status}</p>}
      {confirmRemove ? (
        <div
          className="settings-inline-confirm"
          role="group"
          aria-label="Remove keyfile"
        >
          <p>
            Remove the keyfile from the KDBX credential? This rewrites the
            encrypted vault. The vault must still have a master password
            component.
          </p>
          <div className="stacked-actions">
            <Button
              size="sm"
              variant="danger"
              type="button"
              disabled={controlsDisabled}
              onClick={() => void run("remove")}
            >
              {busy ? "Removing…" : "Confirm remove keyfile"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              disabled={busy}
              onClick={() => {
                setConfirmRemove(false);
              }}
            >
              Keep keyfile
            </Button>
          </div>
        </div>
      ) : (
        <div className="stacked-actions">
          <Button
            size="sm"
            variant="secondary"
            type="button"
            disabled={controlsDisabled}
            onClick={() => void run("replace")}
          >
            {busy
              ? "Updating…"
              : hasKeyfile
                ? "Replace keyfile"
                : "Add keyfile"}
          </Button>
          {hasKeyfile ? (
            <Button
              size="sm"
              variant="danger"
              type="button"
              disabled={controlsDisabled}
              onClick={() => {
                setFailure(null);
                setStatus(null);
                setConfirmRemove(true);
              }}
            >
              Remove keyfile
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function keyfileFailureMessage(action: KeyfileAction, error: unknown): string {
  if (error instanceof DesktopCommandError) {
    if (error.code === "unsaved_changes") {
      return "Save or discard unsaved vault changes before changing the keyfile.";
    }
    if (error.code === "external_change") {
      return "The vault changed on disk. Reload it before changing the keyfile.";
    }
    if (error.code === "unsupported_persistence_platform") {
      return "Keyfile credential changes are not supported safely on this platform yet.";
    }
    if (error.code === "save_uncertain") {
      return "The credential rewrite has uncertain durability. Nian Pass reconciled the current generation when it could prove it; lock and reopen the vault before relying on this change.";
    }
    if (action === "remove" && error.code === "invalid_request") {
      return "The keyfile is the vault's only credential component. Set a master password before removing it.";
    }
  }
  return action === "remove"
    ? "Could not remove the keyfile. The last proven credential remains in use."
    : "Could not update the keyfile. The last proven credential remains in use.";
}
