import { Button } from "../../components/Button";

interface Props {
  busy: boolean;
  onCancel: () => void;
  onRestore: () => void;
}

export function EntryHistoryRestoreDialog({
  busy,
  onCancel,
  onRestore,
}: Props) {
  return (
    <div className="modal-backdrop">
      <section
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-restore-title"
      >
        <h2 id="history-restore-title">Restore this revision?</h2>
        <p>
          The selected historical state will replace the current entry fields.
          The current state is preserved as a new history revision, and nothing
          is written to disk until you Save the vault.
        </p>
        <div className="dialog-actions">
          <Button
            size="sm"
            variant="secondary"
            type="button"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant="primary"
            type="button"
            disabled={busy}
            onClick={onRestore}
          >
            {busy ? "Restoring…" : "Restore revision"}
          </Button>
        </div>
      </section>
    </div>
  );
}
