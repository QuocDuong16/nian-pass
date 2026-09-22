import { Button } from "../../components/Button";

interface PasswordRevealState {
  secret: string | null;
  loading: boolean;
  failed: boolean;
  reveal: () => Promise<void>;
  clear: () => void;
}

interface EntryPasswordFieldProps {
  disabled: boolean;
  passwordPresent: boolean;
  password: PasswordRevealState;
  copying: boolean;
  copyDisabled: boolean;
  onCopy: () => void;
}

export function EntryPasswordField({
  disabled,
  passwordPresent,
  password,
  copying,
  copyDisabled,
  onCopy,
}: EntryPasswordFieldProps) {
  return (
    <section className="detail-field" aria-labelledby="password-label">
      <h3 id="password-label">Password</h3>
      <div className="secret-block">
        {password.secret === null ? (
          <span className="secret-placeholder">
            {passwordPresent ? "••••••••" : "No password"}
          </span>
        ) : (
          <pre className="secret-value">{password.secret}</pre>
        )}
        <div className="detail-actions">
          <Button
            size="sm"
            variant="secondary"
            type="button"
            aria-label={
              password.loading
                ? "Revealing…"
                : password.secret === null
                  ? "Reveal password"
                  : "Hide password"
            }
            disabled={disabled || !passwordPresent || password.loading}
            onClick={() => {
              if (password.secret === null) void password.reveal();
              else password.clear();
            }}
          >
            {password.loading
              ? "Revealing…"
              : password.secret === null
                ? "Reveal"
                : "Hide"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            aria-label="Copy password"
            disabled={disabled || !passwordPresent || copyDisabled}
            onClick={onCopy}
          >
            {copying ? "Copying…" : "Copy"}
          </Button>
        </div>
        {password.failed ? (
          <p role="alert">Could not reveal the password.</p>
        ) : null}
      </div>
    </section>
  );
}
