import type { SyntheticEvent } from "react";

import type { SaveFlowState } from "./useSaveFlow";

interface SaveDialogsProps {
  flow: SaveFlowState;
  password: string;
  onPassword: (password: string) => void;
  onCancel: () => void;
  onRetrySave: () => void;
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

  if (props.flow.kind === "save_error") {
    return (
      <div className="modal-backdrop">
        <section
          className="modal-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="save-error-title"
        >
          <h2 id="save-error-title">Vault was not safely saved</h2>
          <p role="alert">{props.flow.error}</p>
          <div className="dialog-actions">
            <button type="button" onClick={props.onCancel}>
              Continue editing
            </button>
            <button type="button" onClick={props.onRetrySave}>
              Try Save again
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (
    props.flow.kind !== "reload_credential" &&
    props.flow.kind !== "reloading"
  ) {
    return null;
  }

  const busy = props.flow.kind === "reloading";
  const error = "error" in props.flow ? props.flow.error : null;
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onReload();
  };

  return (
    <div className="modal-backdrop">
      <section
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reload-credential-title"
      >
        <h2 id="reload-credential-title">Reload current file</h2>
        <p>
          Reloading discards unsaved Nian Pass changes and loads the current
          file from disk. Re-enter the master password because the external file
          may have changed independently.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="reload-master-password">Master password</label>
          <input
            id="reload-master-password"
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
              onClick={props.onReloadCancel}
            >
              Cancel
            </button>
            <button type="submit" disabled={busy || props.password === ""}>
              {busy ? "Reloading…" : "Discard local changes and reload"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
