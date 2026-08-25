import type { SyntheticEvent } from "react";

import type { SaveFlowState } from "./useSaveFlow";

interface SaveDialogsProps {
  flow: SaveFlowState;
  password: string;
  onPassword: (password: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onReloadChoice: () => void;
  onReloadCancel: () => void;
  onReload: () => void;
}

export function SaveDialogs(props: SaveDialogsProps) {
  if (props.flow.kind === "external_conflict") {
    return (
      <div className="modal-backdrop">
        <section
          className="modal-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="external-conflict-title"
        >
          <h2 id="external-conflict-title">
            The KDBX file changed outside Nian Pass
          </h2>
          <p>Nian Pass will not overwrite those external changes.</p>
          <div className="dialog-actions stacked-actions">
            <button type="button" onClick={props.onCancel}>
              Cancel
            </button>
            <button
              className="danger-button"
              type="button"
              onClick={props.onReloadChoice}
            >
              Discard local changes and reload
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (
    props.flow.kind !== "credential" &&
    props.flow.kind !== "saving" &&
    props.flow.kind !== "reload_credential" &&
    props.flow.kind !== "reloading"
  ) {
    return null;
  }

  const reload =
    props.flow.kind === "reload_credential" || props.flow.kind === "reloading";
  const busy = props.flow.kind === "saving" || props.flow.kind === "reloading";
  const error = "error" in props.flow ? props.flow.error : null;
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (reload) props.onReload();
    else props.onSave();
  };

  return (
    <div className="modal-backdrop">
      <section
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-credential-title"
      >
        <h2 id="save-credential-title">
          {reload ? "Reload current file" : "Save changes"}
        </h2>
        <p>
          {reload
            ? "Reloading will discard your unsaved Nian Pass changes and load the current file from disk."
            : "Enter the vault master password to encrypt and save this KDBX file."}
        </p>
        <form onSubmit={submit}>
          <label htmlFor="save-master-password">Master password</label>
          <input
            id="save-master-password"
            type="password"
            autoComplete="current-password"
            spellCheck={false}
            value={props.password}
            disabled={busy}
            autoFocus
            onChange={(event) => {
              props.onPassword(event.currentTarget.value);
            }}
          />
          {error === null ? null : <p role="alert">{error}</p>}
          <div className="dialog-actions">
            <button
              type="button"
              disabled={busy}
              onClick={reload ? props.onReloadCancel : props.onCancel}
            >
              Cancel
            </button>
            <button type="submit" disabled={busy || props.password === ""}>
              {busy
                ? reload
                  ? "Reloading…"
                  : "Saving…"
                : reload
                  ? "Discard local changes and reload"
                  : "Save"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
