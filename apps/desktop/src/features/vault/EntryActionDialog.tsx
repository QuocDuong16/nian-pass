import { Button } from "../../components/Button";
import type { GroupDto } from "../../types/desktop";

export type EntryAction = "move" | "trash" | "permanent-delete";

interface EntryActionDialogProps {
  action: EntryAction;
  busy: boolean;
  destination: string;
  groups: GroupDto[];
  onDestination: (value: string) => void;
  onCancel: () => void;
  onApply: () => void;
}

export function EntryActionDialog(props: EntryActionDialogProps) {
  return (
    <div className="modal-backdrop">
      <section
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="entry-action-title"
      >
        <h2 id="entry-action-title">
          {props.action === "move"
            ? "Move entry"
            : props.action === "trash"
              ? "Move entry to Trash?"
              : "Delete entry permanently?"}
        </h2>
        {props.action === "move" ? (
          <>
            <label htmlFor="entry-destination">Destination group</label>
            <select
              id="entry-destination"
              value={props.destination}
              onChange={(event) => {
                props.onDestination(event.currentTarget.value);
              }}
            >
              {props.groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name || "Unnamed group"}
                </option>
              ))}
            </select>
          </>
        ) : props.action === "trash" ? (
          <p>
            The entry will move to Trash and can be restored later. Saving the
            vault persists this move without creating a deletion tombstone.
          </p>
        ) : (
          <p>
            This permanently removes the entry from Trash and records a deletion
            tombstone. This cannot be undone after saving.
          </p>
        )}
        <div className="dialog-actions">
          <Button
            size="sm"
            variant="secondary"
            type="button"
            disabled={props.busy}
            onClick={props.onCancel}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant={props.action === "move" ? "primary" : "danger"}
            type="button"
            aria-label={
              props.action === "move"
                ? "Move entry"
                : props.action === "trash"
                  ? "Confirm move entry to Trash"
                  : "Confirm permanent entry deletion"
            }
            disabled={
              props.busy ||
              (props.action === "move" && props.destination === "")
            }
            onClick={props.onApply}
          >
            {props.busy
              ? "Applying…"
              : props.action === "move"
                ? "Move"
                : props.action === "trash"
                  ? "Move to Trash"
                  : "Delete permanently"}
          </Button>
        </div>
      </section>
    </div>
  );
}
