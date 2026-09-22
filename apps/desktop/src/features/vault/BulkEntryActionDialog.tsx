import { useState } from "react";

import { Button } from "../../components/Button";
import type { GroupDto } from "../../types/desktop";

interface BulkEntryActionDialogProps {
  kind: "move" | "trash" | "restore" | "delete";
  count: number;
  groups: GroupDto[];
  currentGroupId: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onMove: (destinationGroupId: string) => void;
  onTrash: () => void;
  onRestore: () => void;
  onPermanentDelete: () => void;
}

export function BulkEntryActionDialog(props: BulkEntryActionDialogProps) {
  const destinations = props.groups.filter(
    (group) => group.id !== props.currentGroupId,
  );
  const [destinationGroupId, setDestinationGroupId] = useState(
    destinations[0]?.id ?? "",
  );
  const plural = props.count === 1 ? "entry" : "entries";
  const title =
    props.kind === "move"
      ? `Move ${String(props.count)} ${plural}`
      : props.kind === "trash"
        ? `Move ${String(props.count)} ${plural} to Trash`
        : props.kind === "restore"
          ? `Restore ${String(props.count)} ${plural}`
          : `Delete ${String(props.count)} ${plural} permanently`;
  const description =
    props.kind === "move"
      ? "The whole batch is applied atomically. If one entry cannot move, none of them move."
      : props.kind === "trash"
        ? "The whole batch remains recoverable in Trash until permanently deleted."
        : props.kind === "restore"
          ? "Every entry is restored atomically to its previous safe group, or the vault root when that group no longer exists."
          : "This permanently deletes the selected entries from Trash and cannot be undone.";
  const actionLabel =
    props.kind === "move"
      ? "Move entries"
      : props.kind === "trash"
        ? "Move to Trash"
        : props.kind === "restore"
          ? "Restore entries"
          : "Delete permanently";
  const busyLabel = props.kind === "restore" ? "Restoring…" : "Working…";
  const confirm = () => {
    if (props.kind === "move") {
      props.onMove(destinationGroupId);
      return;
    }
    if (props.kind === "trash") {
      props.onTrash();
      return;
    }
    if (props.kind === "restore") {
      props.onRestore();
      return;
    }
    props.onPermanentDelete();
  };

  return (
    <div className="modal-backdrop">
      <section
        className="modal-panel bulk-entry-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-entry-dialog-title"
      >
        <div className="modal-heading">
          <h2 id="bulk-entry-dialog-title">{title}</h2>
          <p>{description}</p>
        </div>

        {props.kind === "move" ? (
          <label className="field-stack">
            <span>Destination group</span>
            <select
              value={destinationGroupId}
              disabled={props.busy || destinations.length === 0}
              onChange={(event) => {
                setDestinationGroupId(event.currentTarget.value);
              }}
            >
              {destinations.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name || "Unnamed group"}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {props.error === null ? null : (
          <p className="shell-error" role="alert">
            {props.error}
          </p>
        )}

        <div className="modal-actions">
          <Button
            size="sm"
            variant="ghost"
            type="button"
            disabled={props.busy}
            onClick={props.onCancel}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant={
              props.kind === "move" || props.kind === "restore"
                ? "primary"
                : "danger"
            }
            type="button"
            disabled={
              props.busy || (props.kind === "move" && destinationGroupId === "")
            }
            onClick={confirm}
          >
            {props.busy ? busyLabel : actionLabel}
          </Button>
        </div>
      </section>
    </div>
  );
}
