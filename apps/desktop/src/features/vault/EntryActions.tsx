import { useState } from "react";

import { Button } from "../../components/Button";
import type {
  CreatedEntryBaseDto,
  EntryDetailDto,
  GroupDto,
  GroupId,
  VaultCoreSnapshotDto,
  VaultSnapshotDto,
} from "../../types/desktop";
import type { EntryActionsApi } from "../../types/mutation-api";
import { EntryActionDialog, type EntryAction } from "./EntryActionDialog";
import { useSecurityFormTelemetry } from "./useSecurityFormTelemetry";

interface EntryActionsProps<
  TSnapshot extends VaultCoreSnapshotDto = VaultSnapshotDto,
> {
  api: EntryActionsApi<TSnapshot>;
  detail: EntryDetailDto;
  groups: GroupDto[];
  disabled: boolean;
  recycled?: boolean;
  recycleBinEnabled?: boolean;
  onMoved: (snapshot: TSnapshot, destination: GroupId) => void;
  onDuplicated?: ((result: CreatedEntryBaseDto<TSnapshot>) => void) | undefined;
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
  recycled = false,
  recycleBinEnabled = true,
  onMoved,
  onDuplicated,
  onDeleted,
  onDraftChange,
  onBusyChange,
}: EntryActionsProps<TSnapshot>) {
  const [action, setAction] = useState<EntryAction | null>(null);
  const [destination, setDestination] = useState(groups[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const duplicateEntry = api.duplicateEntry;
  const duplicated = onDuplicated;

  useSecurityFormTelemetry(action !== null, busy, onDraftChange, onBusyChange);

  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await operation();
      setAction(null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const duplicate = () => {
    if (duplicateEntry === undefined || duplicated === undefined) return;
    void run(async () => {
      duplicated(await duplicateEntry(detail.id));
    });
  };

  const restore = () => {
    if (api.restoreEntry === undefined) return;
    void run(async () => {
      const snapshot = await api.restoreEntry?.(detail.id);
      if (snapshot === undefined) return;
      const restored = snapshot.entries.find((entry) => entry.id === detail.id);
      if (restored === undefined) {
        onDeleted(snapshot);
        return;
      }
      onMoved(snapshot, restored.groupId);
    });
  };

  const apply = () => {
    if (action === null) return;
    void run(async () => {
      if (action === "trash") {
        onDeleted(await api.deleteEntry(detail.id));
        return;
      }
      if (action === "permanent-delete") {
        const permanentlyDelete = api.permanentlyDeleteEntry;
        if (permanentlyDelete === undefined) return;
        onDeleted(await permanentlyDelete(detail.id));
        return;
      }
      const snapshot = await api.moveEntry(detail.id, destination);
      onMoved(snapshot, destination);
    });
  };

  const open = (next: EntryAction) => {
    setFailed(false);
    setAction(next);
  };

  return (
    <div className="detail-actions destructive-actions">
      {!recycled && duplicateEntry !== undefined && duplicated !== undefined ? (
        <Button
          size="sm"
          variant="secondary"
          type="button"
          aria-label="Duplicate entry"
          disabled={disabled || busy}
          onClick={duplicate}
        >
          {busy && action === null ? "Duplicating…" : "Duplicate"}
        </Button>
      ) : null}

      {recycled ? (
        <>
          {api.restoreEntry === undefined ? null : (
            <Button
              size="sm"
              variant="primary"
              type="button"
              aria-label="Restore entry"
              disabled={disabled || busy}
              onClick={restore}
            >
              {busy && action === null ? "Restoring…" : "Restore"}
            </Button>
          )}
          {api.permanentlyDeleteEntry === undefined ? null : (
            <Button
              size="sm"
              variant="danger"
              type="button"
              aria-label="Permanently delete entry"
              disabled={disabled || busy}
              onClick={() => {
                open("permanent-delete");
              }}
            >
              Delete permanently
            </Button>
          )}
        </>
      ) : (
        <>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            aria-label="Move entry"
            disabled={disabled || busy}
            onClick={() => {
              open("move");
            }}
          >
            Move
          </Button>
          {recycleBinEnabled ? (
            <Button
              size="sm"
              variant="danger"
              type="button"
              aria-label="Move entry to Trash"
              disabled={disabled || busy}
              onClick={() => {
                open("trash");
              }}
            >
              Move to Trash
            </Button>
          ) : null}
        </>
      )}

      {failed ? (
        <p role="alert">Could not complete the entry operation.</p>
      ) : null}

      {action !== null ? (
        <EntryActionDialog
          action={action}
          busy={busy}
          destination={destination}
          groups={groups}
          onDestination={setDestination}
          onCancel={() => {
            setAction(null);
          }}
          onApply={apply}
        />
      ) : null}
    </div>
  );
}
