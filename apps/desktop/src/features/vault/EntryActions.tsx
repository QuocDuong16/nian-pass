import { useState } from "react";

import { Button } from "../../components/Button";
import type {
  EntryDetailDto,
  GroupDto,
  GroupId,
  VaultCoreSnapshotDto,
  VaultSnapshotDto,
} from "../../types/desktop";
import type { EntryActionsApi } from "../../types/mutation-api";
import { useSecurityFormTelemetry } from "./useSecurityFormTelemetry";

type Action = "move" | "delete";

interface EntryActionsProps<
  TSnapshot extends VaultCoreSnapshotDto = VaultSnapshotDto,
> {
  api: EntryActionsApi<TSnapshot>;
  detail: EntryDetailDto;
  groups: GroupDto[];
  disabled: boolean;
  onMoved: (snapshot: TSnapshot, destination: GroupId) => void;
  onDeleted: (snapshot: TSnapshot) => void;
  onDraftChange?: (active: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}

export function EntryActions<
  TSnapshot extends VaultCoreSnapshotDto = VaultSnapshotDto,
>({
  api,
  detail,
  groups,
  disabled,
  onMoved,
  onDeleted,
  onDraftChange,
  onBusyChange,
}: EntryActionsProps<TSnapshot>) {
  const [action, setAction] = useState<Action | null>(null);
  const [destination, setDestination] = useState(groups[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useSecurityFormTelemetry(action !== null, busy, onDraftChange, onBusyChange);

  const apply = async () => {
    if (action === null || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      if (action === "delete") {
        onDeleted(await api.deleteEntry(detail.id));
      } else {
        const snapshot = await api.moveEntry(detail.id, destination);
        onMoved(snapshot, destination);
      }
      setAction(null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="detail-actions destructive-actions">
      <Button
        size="sm"
        variant="ghost"
        type="button"
        aria-label="Move entry"
        disabled={disabled}
        onClick={() => {
          setAction("move");
        }}
      >
        Move
      </Button>
      <Button
        size="sm"
        variant="danger"
        type="button"
        aria-label="Permanently delete entry"
        disabled={disabled}
        onClick={() => {
          setAction("delete");
        }}
      >
        Delete
      </Button>
      {failed ? (
        <p role="alert">Could not complete the entry operation.</p>
      ) : null}
      {action !== null ? (
        <div className="modal-backdrop">
          <section
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="entry-action-title"
          >
            <h2 id="entry-action-title">
              {action === "delete" ? "Permanently delete entry?" : "Move entry"}
            </h2>
            {action === "delete" ? (
              <p>
                This removes the entry from the vault and records a deletion
                tombstone. M4.3 does not implement a recycle bin.
              </p>
            ) : (
              <>
                <label htmlFor="entry-destination">Destination group</label>
                <select
                  id="entry-destination"
                  value={destination}
                  onChange={(event) => {
                    setDestination(event.currentTarget.value);
                  }}
                >
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name || "Unnamed group"}
                    </option>
                  ))}
                </select>
              </>
            )}
            <div className="dialog-actions">
              <Button
                size="sm"
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  setAction(null);
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant={action === "delete" ? "danger" : "primary"}
                type="button"
                aria-label={
                  action === "delete" ? "Permanently delete" : "Move entry"
                }
                disabled={busy || (action === "move" && destination === "")}
                onClick={() => void apply()}
              >
                {busy
                  ? "Applying…"
                  : action === "delete"
                    ? "Delete permanently"
                    : "Move"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
