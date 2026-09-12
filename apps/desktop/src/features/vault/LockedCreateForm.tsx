import type { SyntheticEvent } from "react";

interface LockedCreateFormProps {
  vaultName: string;
  password: string;
  confirmPassword: string;
  busy: boolean;
  onVaultName: (value: string) => void;
  onPassword: (value: string) => void;
  onConfirmPassword: (value: string) => void;
  onSubmit: (event: SyntheticEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}

function passwordStrength(password: string): { label: string; score: number } {
  let score = 0;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  if (/[A-Z]/u.test(password) && /[a-z]/u.test(password)) score += 1;
  if (/\d/u.test(password) && /[^A-Za-z0-9]/u.test(password)) score += 1;
  const labels = ["Very weak", "Weak", "Fair", "Good", "Strong"];
  return { label: labels[score] ?? "Very weak", score };
}

export function LockedCreateForm(props: LockedCreateFormProps) {
  const strength = passwordStrength(props.password);
  return (
    <form
      onSubmit={props.onSubmit}
      onKeyDown={(event) => {
        if (event.key === "Escape") props.onCancel();
      }}
    >
      <label htmlFor="vault-name">Vault name</label>
      <input
        id="vault-name"
        value={props.vaultName}
        autoFocus
        disabled={props.busy}
        onChange={(event) => {
          props.onVaultName(event.target.value);
        }}
      />
      <label>Save location</label>
      <p className="field-hint">
        Choose the .kdbx location in the native save dialog when you create the
        vault.
      </p>
      <label htmlFor="new-master-password">Master password</label>
      <input
        id="new-master-password"
        type="password"
        autoComplete="new-password"
        spellCheck={false}
        value={props.password}
        disabled={props.busy}
        onChange={(event) => {
          props.onPassword(event.target.value);
        }}
      />
      <div
        className="password-strength"
        data-score={strength.score}
        aria-live="polite"
      >
        Password strength: {strength.label}
      </div>
      <label htmlFor="confirm-master-password">Confirm master password</label>
      <input
        id="confirm-master-password"
        type="password"
        autoComplete="new-password"
        spellCheck={false}
        value={props.confirmPassword}
        disabled={props.busy}
        onChange={(event) => {
          props.onConfirmPassword(event.target.value);
        }}
      />
      <div className="dialog-actions">
        <button type="button" disabled={props.busy} onClick={props.onCancel}>
          Cancel
        </button>
        <button
          className="primary-button"
          type="submit"
          disabled={
            props.busy ||
            props.vaultName.trim() === "" ||
            props.password === "" ||
            props.password !== props.confirmPassword
          }
        >
          {props.busy ? "Creating…" : "Create vault"}
        </button>
      </div>
    </form>
  );
}
