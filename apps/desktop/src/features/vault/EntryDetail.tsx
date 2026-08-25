import { useEffect, useState } from "react";

import type { DesktopApi } from "../../lib/desktop";
import type {
  EntryDetailDto,
  EntryId,
  GroupDto,
  GroupId,
  VaultSnapshotDto,
} from "../../types/desktop";
import { EntryEditForm } from "./EntryEditForm";
import { EntryReadView } from "./EntryReadView";

interface EntryDetailProps {
  api: DesktopApi;
  entryId: EntryId;
  groups: GroupDto[];
  disabled: boolean;
  onEditingChange?: (editing: boolean) => void;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
  onDeleted: (snapshot: VaultSnapshotDto) => void;
  onMoved: (snapshot: VaultSnapshotDto, destination: GroupId) => void;
}

export function EntryDetail(props: EntryDetailProps) {
  return (
    <EntryDetailContent
      key={`${props.entryId}:${String(props.disabled)}`}
      {...props}
    />
  );
}

function EntryDetailContent({
  api,
  entryId,
  groups,
  disabled,
  onEditingChange,
  onSnapshot,
  onDeleted,
  onMoved,
}: EntryDetailProps) {
  const [detail, setDetail] = useState<EntryDetailDto | null>(null);
  const [detailFailed, setDetailFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(
    () => () => {
      onEditingChange?.(false);
    },
    [onEditingChange],
  );

  useEffect(() => {
    let active = true;
    void api
      .getEntryDetail(entryId)
      .then((value) => {
        if (active && value.id === entryId) setDetail(value);
      })
      .catch(() => {
        if (active) setDetailFailed(true);
      });
    return () => {
      active = false;
    };
  }, [api, entryId, refresh]);

  const changed = (snapshot: VaultSnapshotDto) => {
    onSnapshot(snapshot);
    setEditing(false);
    onEditingChange?.(false);
    setDetail(null);
    setDetailFailed(false);
    setRefresh((value) => value + 1);
  };

  if (detailFailed) {
    return (
      <aside className="detail-pane" aria-label="Entry detail">
        <p className="detail-error" role="alert">
          Could not load this entry.
        </p>
      </aside>
    );
  }
  if (detail === null) {
    return (
      <aside className="detail-pane" aria-label="Entry detail">
        <p className="detail-loading">Loading entry…</p>
      </aside>
    );
  }

  return (
    <aside className="detail-pane" aria-label="Entry detail">
      {editing ? (
        <EntryEditForm
          api={api}
          detail={detail}
          disabled={disabled}
          onApplied={changed}
          onCancel={() => {
            setEditing(false);
            onEditingChange?.(false);
          }}
        />
      ) : (
        <EntryReadView
          api={api}
          detail={detail}
          groups={groups}
          disabled={disabled}
          onEdit={() => {
            setEditing(true);
            onEditingChange?.(true);
          }}
          onSnapshot={changed}
          onDeleted={onDeleted}
          onMoved={(snapshot, destination) => {
            onMoved(snapshot, destination);
            setDetail(null);
            setDetailFailed(false);
            setRefresh((value) => value + 1);
          }}
        />
      )}
    </aside>
  );
}
