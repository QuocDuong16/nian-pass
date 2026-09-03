import type { SyncConflictOperation } from "../../lib/sync";

export type ConflictChoice = "keepLocal" | "keepRemote";

interface SyncConflictPanelProps {
  conflict: SyncConflictOperation;
  confirmChoice: ConflictChoice | null;
  busy: boolean;
  confirmationDisabled: boolean;
  onChoose: (choice: ConflictChoice) => void;
  onConfirm: (choice: ConflictChoice) => void;
  onBack: () => void;
  onCancel: () => void;
}

export function SyncConflictPanel({
  conflict,
  confirmChoice,
  busy,
  confirmationDisabled,
  onChoose,
  onConfirm,
  onBack,
  onCancel,
}: SyncConflictPanelProps) {
  return (
    <div
      className="sync-conflict"
      role="alertdialog"
      aria-labelledby="sync-conflict-heading"
    >
      <h3 id="sync-conflict-heading">Explicit conflict decision required</h3>
      <p>
        {conflict.initialConflict
          ? "No proven common BASE exists."
          : `${conflict.conflicts.length.toString()} structured conflict(s) were found.`}{" "}
        No conflicting secret values are displayed.
      </p>
      {confirmChoice === null ? (
        <div className="dialog-actions destructive-actions">
          <button
            type="button"
            className="danger-button"
            disabled={busy}
            onClick={() => {
              onChoose("keepLocal");
            }}
          >
            Use local as authoritative
          </button>
          <button
            type="button"
            className="danger-button"
            disabled={busy}
            onClick={() => {
              onChoose("keepRemote");
            }}
          >
            Use remote as authoritative
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      ) : (
        <div>
          <p>
            This will overwrite the{" "}
            {confirmChoice === "keepLocal" ? "remote" : "local"} generation
            after exact revalidation.
          </p>
          <div className="dialog-actions destructive-actions">
            <button
              type="button"
              className="danger-button"
              disabled={confirmationDisabled}
              onClick={() => {
                onConfirm(confirmChoice);
              }}
            >
              Confirm destructive choice
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={busy}
              onClick={onBack}
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
