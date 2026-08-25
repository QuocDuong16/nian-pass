interface DiscardDialogProps {
  closing: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DiscardDialog({
  closing,
  busy,
  onCancel,
  onConfirm,
}: DiscardDialogProps) {
  return (
    <div className="modal-backdrop">
      <section
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="discard-title"
      >
        <h2 id="discard-title">Unsaved changes will be discarded</h2>
        <p>M4.3 cannot save changes yet.</p>
        <p>
          {closing
            ? "Discard the in-memory changes and close Nian Pass?"
            : "Discard the in-memory changes and lock the vault?"}
        </p>
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            className="danger-button"
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "Discarding…" : "Discard changes and lock"}
          </button>
        </div>
      </section>
    </div>
  );
}
