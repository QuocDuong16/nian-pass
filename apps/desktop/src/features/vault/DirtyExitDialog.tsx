import type { SaveIntent } from "./useSaveFlow";

interface DirtyExitDialogProps {
  intent: Extract<SaveIntent, "lock" | "close">;
  busy: boolean;
  onCancel: () => void;
  onSave: () => void;
  onDiscard: () => void;
}

export function DirtyExitDialog({
  intent,
  busy,
  onCancel,
  onSave,
  onDiscard,
}: DirtyExitDialogProps) {
  const closing = intent === "close";
  return (
    <div className="modal-backdrop">
      <section
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dirty-exit-title"
      >
        <h2 id="dirty-exit-title">Unsaved changes</h2>
        <p>
          {closing
            ? "Save your changes before closing Nian Pass, or explicitly discard them."
            : "Save your changes before locking the vault, or explicitly discard them."}
        </p>
        <div className="dialog-actions stacked-actions">
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" disabled={busy} onClick={onSave}>
            {closing ? "Save changes and close" : "Save changes and lock"}
          </button>
          <button
            className="danger-button"
            type="button"
            disabled={busy}
            onClick={onDiscard}
          >
            {closing ? "Discard changes and close" : "Discard changes and lock"}
          </button>
        </div>
      </section>
    </div>
  );
}
