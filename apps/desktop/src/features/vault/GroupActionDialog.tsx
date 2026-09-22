import { Button } from "../../components/Button";
import type { GroupDto } from "../../types/desktop";

export type GroupAction =
  "create" | "rename" | "move" | "trash" | "permanent-delete";

interface GroupActionDialogProps {
  action: GroupAction;
  busy: boolean;
  name: string;
  destination: string;
  destinations: GroupDto[];
  onName: (value: string) => void;
  onDestination: (value: string) => void;
  onCancel: () => void;
  onApply: () => void;
}

export function GroupActionDialog(props: GroupActionDialogProps) {
  const title =
    props.action === "create"
      ? "New group"
      : props.action === "rename"
        ? "Rename group"
        : props.action === "move"
          ? "Move group"
          : props.action === "trash"
            ? "Move group to Trash?"
            : "Delete group permanently?";

  return (
    <div className="modal-backdrop">
      <section
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="group-action-title"
      >
        <h2 id="group-action-title">{title}</h2>
        {props.action === "trash" ? (
          <p>
            The group and its descendants will move to Trash and can be restored
            later.
          </p>
        ) : props.action === "permanent-delete" ? (
          <p>
            This permanently removes the group subtree from Trash and records
            deletion tombstones. This cannot be undone after saving.
          </p>
        ) : props.action === "move" ? (
          <>
            <label htmlFor="group-destination">Destination parent</label>
            <select
              id="group-destination"
              value={props.destination}
              onChange={(event) => {
                props.onDestination(event.currentTarget.value);
              }}
            >
              {props.destinations.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name || "Unnamed group"}
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            <label htmlFor="group-name">Group name</label>
            <input
              id="group-name"
              value={props.name}
              onChange={(event) => {
                props.onName(event.currentTarget.value);
              }}
            />
          </>
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
            variant={
              props.action === "trash" || props.action === "permanent-delete"
                ? "danger"
                : "primary"
            }
            type="button"
            disabled={
              props.busy ||
              ((props.action === "create" || props.action === "rename") &&
                props.name.trim() === "") ||
              (props.action === "move" && props.destination === "")
            }
            onClick={props.onApply}
          >
            {props.busy
              ? "Applying…"
              : props.action === "trash"
                ? "Move to Trash"
                : props.action === "permanent-delete"
                  ? "Delete permanently"
                  : "Apply"}
          </Button>
        </div>
      </section>
    </div>
  );
}
