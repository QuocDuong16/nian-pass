export type MobileSecurityAttention =
  "locking" | "dirty" | "draft" | "lock_error";

interface Props {
  attention: MobileSecurityAttention | null;
  backgrounded: boolean;
  refreshing: boolean;
  onContinue: () => void;
  onDiscardDraft: () => void;
  onSaveAndLock: () => void;
  onDiscardAndLock: () => void;
  onRetryLock: () => void;
}

export function MobileSecurityShield(props: Props) {
  if (props.backgrounded) {
    return (
      <main className="security-shield" aria-labelledby="mobile-private-title">
        <section className="security-card">
          <h1 id="mobile-private-title">Nian Pass locked</h1>
          <p>Sensitive content is unavailable while the app is not active.</p>
        </section>
      </main>
    );
  }

  if (props.refreshing || props.attention === "locking") {
    return (
      <main className="security-shield" aria-labelledby="mobile-locking-title">
        <section className="security-card">
          <h1 id="mobile-locking-title">Securing your vault</h1>
          <p>Nian Pass is reconciling the current protected operation.</p>
        </section>
      </main>
    );
  }

  if (props.attention === "draft") {
    return (
      <main className="security-shield" aria-labelledby="mobile-draft-title">
        <section className="security-card">
          <h1 id="mobile-draft-title">Unfinished edit</h1>
          <p>The local draft has not been discarded or applied.</p>
          <div className="dialog-actions stacked-actions">
            <button type="button" onClick={props.onContinue}>
              Continue editing
            </button>
            <button
              className="danger-button"
              type="button"
              onClick={props.onDiscardDraft}
            >
              Discard local draft
            </button>
          </div>
        </section>
      </main>
    );
  }

  if (props.attention === "dirty") {
    return (
      <main className="security-shield" aria-labelledby="mobile-dirty-title">
        <section className="security-card">
          <h1 id="mobile-dirty-title">Unsaved changes are still open</h1>
          <p>Nian Pass has not saved or discarded the dirty Rust session.</p>
          <div className="dialog-actions stacked-actions">
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
            <button type="button" onClick={props.onContinue}>
              Continue editing
            </button>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="security-shield" aria-labelledby="mobile-lock-error-title">
      <section className="security-card">
        <h1 id="mobile-lock-error-title">Lock could not complete</h1>
        <p>The vault remains protected behind this shield.</p>
        <button type="button" onClick={props.onRetryLock}>
          Retry Lock
        </button>
      </section>
    </main>
  );
}
