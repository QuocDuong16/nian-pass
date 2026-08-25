export type SecurityAttention =
  | { kind: "dirty" }
  | { kind: "draft"; reason: "idle" | "manual" | "close" }
  | { kind: "locking" }
  | { kind: "lock_error" };

interface SecurityShieldProps {
  attention: SecurityAttention | null;
  backgrounded: boolean;
  expiryPending: boolean;
  operationPending: boolean;
  onContinue: () => void;
  onDiscardDraft: () => void;
  onSaveAndLock: () => void;
  onDiscardAndLock: () => void;
  onRetryLock: () => void;
}

export function SecurityShield(props: SecurityShieldProps) {
  if (props.backgrounded) {
    return (
      <main className="security-shield" aria-labelledby="privacy-shield-title">
        <section className="security-card">
          <div className="brand-mark" aria-hidden="true">
            N
          </div>
          <h1 id="privacy-shield-title">Content hidden</h1>
          <p>Nian Pass content is hidden while the window is not active.</p>
        </section>
      </main>
    );
  }

  if (
    props.expiryPending ||
    props.operationPending ||
    props.attention?.kind === "locking"
  ) {
    return (
      <main
        className="security-shield"
        aria-labelledby="security-pending-title"
      >
        <section className="security-card">
          <h1 id="security-pending-title">Securing your vault</h1>
          <p>Nian Pass is waiting for the current operation to finish.</p>
        </section>
      </main>
    );
  }

  if (props.attention === null) return null;

  if (props.attention.kind === "draft") {
    const closing = props.attention.reason === "close";
    return (
      <main className="security-shield" aria-labelledby="draft-shield-title">
        <section className="security-card">
          <h1 id="draft-shield-title">Unfinished edit</h1>
          <p>
            Nian Pass cannot {closing ? "close" : "lock"} while an unfinished
            edit or confirmation is open. It has not been applied to the vault.
          </p>
          <div className="dialog-actions stacked-actions">
            <button type="button" onClick={props.onContinue}>
              Return to edit
            </button>
            <button
              className="danger-button"
              type="button"
              onClick={props.onDiscardDraft}
            >
              Discard unfinished edit and {closing ? "close" : "continue"}
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (props.attention.kind === "lock_error") {
    return (
      <main className="security-shield" aria-labelledby="lock-error-title">
        <section className="security-card">
          <h1 id="lock-error-title">Auto-lock failed</h1>
          <p>
            Nian Pass could not auto-lock the vault. The session remains
            unlocked.
          </p>
          <div className="dialog-actions">
            <button type="button" onClick={props.onContinue}>
              Continue editing
            </button>
            <button type="button" onClick={props.onRetryLock}>
              Try locking again
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="security-shield" aria-labelledby="idle-shield-title">
      <section className="security-card">
        <h1 id="idle-shield-title">Unsaved changes need attention</h1>
        <p>
          Nian Pass wanted to auto-lock, but this vault has unsaved changes.
        </p>
        <div className="dialog-actions stacked-actions">
          <button type="button" onClick={props.onContinue}>
            Continue editing
          </button>
          <button type="button" onClick={props.onSaveAndLock}>
            Save and lock
          </button>
          <button
            className="danger-button"
            type="button"
            onClick={props.onDiscardAndLock}
          >
            Discard changes and lock
          </button>
        </div>
      </section>
    </main>
  );
}
