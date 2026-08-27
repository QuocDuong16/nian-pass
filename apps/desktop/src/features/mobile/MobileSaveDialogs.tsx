import type { SyntheticEvent } from "react";

import type { MobileSaveFlow } from "./useMobileSaveFlow";

interface Props {
  flow: MobileSaveFlow;
  password: string;
  onPassword: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onReloadChoice: () => void;
  onReloadCancel: () => void;
  onReload: () => void;
  onDismissUncertain: () => void;
}

export function MobileSaveDialogs(props: Props) {
  if (props.flow.kind === "recovery_required") {
    return (
      <Dialog title="Unfinished save operation">
        <p>
          This vault has an unfinished save operation. Nian Pass cannot safely
          continue until the source is reconciled.
        </p>
      </Dialog>
    );
  }
  if (props.flow.kind === "uncertain") {
    return (
      <Dialog title="Save state is uncertain">
        <p>
          Nian Pass cannot prove the final provider state. The vault remains
          open and no lock action will continue.
        </p>
        <button type="button" onClick={props.onDismissUncertain}>
          Review vault
        </button>
      </Dialog>
    );
  }
  if (props.flow.kind === "external_conflict") {
    return (
      <Dialog title="The provider document changed">
        <p>Nian Pass refused to overwrite the external generation.</p>
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
      </Dialog>
    );
  }
  if (
    !["credential", "saving", "reload_credential", "reloading"].includes(
      props.flow.kind,
    )
  )
    return null;
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
    <Dialog title={reload ? "Reload provider document" : "Save Android vault"}>
      <p>
        {reload
          ? "Reload discards local changes only after the current provider document opens successfully."
          : "Enter the master password again. Nian Pass does not retain the unlock credential."}
      </p>
      <form onSubmit={submit}>
        <label htmlFor="mobile-save-password">Master password</label>
        <input
          id="mobile-save-password"
          type="password"
          autoComplete="current-password"
          value={props.password}
          disabled={busy}
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
            {busy ? "Verifying…" : reload ? "Reload" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Dialog(props: { title: string; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop">
      <section className="modal-panel" role="dialog" aria-modal="true">
        <h2>{props.title}</h2>
        {props.children}
      </section>
    </div>
  );
}
