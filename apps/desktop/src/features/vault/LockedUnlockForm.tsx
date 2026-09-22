import type { SyntheticEvent } from "react";

import type { SelectedKeyfileDto, SelectedVaultDto } from "../../types/desktop";

interface LockedUnlockFormProps {
  selection: SelectedVaultDto;
  password: string;
  keyfile: SelectedKeyfileDto | null;
  busy: boolean;
  onPassword: (value: string) => void;
  onChooseKeyfile: () => void;
  onRemoveKeyfile: () => void;
  onChooseVault: () => void;
  onCancel: () => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
}

export function LockedUnlockForm({
  selection,
  password,
  keyfile,
  busy,
  onPassword,
  onChooseKeyfile,
  onRemoveKeyfile,
  onChooseVault,
  onCancel,
  onSubmit,
}: LockedUnlockFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      onKeyDown={(event) => {
        if (event.key === "Escape") onCancel();
      }}
    >
      <p className="selected-file">{selection.fileName}</p>
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
          onPassword(event.target.value);
        }}
        disabled={busy}
      />
      <div className="keyfile-picker">
        <div>
          <span className="keyfile-label">Key file</span>
          <span className="keyfile-value">
            {keyfile?.fileName ?? "Not selected"}
          </span>
        </div>
        <div className="keyfile-actions">
          <button type="button" disabled={busy} onClick={onChooseKeyfile}>
            {keyfile === null ? "Choose key file" : "Change key file"}
          </button>
          {keyfile === null ? null : (
            <button type="button" disabled={busy} onClick={onRemoveKeyfile}>
              Remove
            </button>
          )}
        </div>
      </div>
      <div className="dialog-actions">
        <button type="button" disabled={busy} onClick={onChooseVault}>
          Choose another vault
        </button>
        <button
          className="primary-button"
          type="submit"
          disabled={(password === "" && keyfile === null) || busy}
        >
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </div>
    </form>
  );
}
