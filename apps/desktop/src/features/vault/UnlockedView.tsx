import { useMemo, useState } from "react";

import type { DesktopApi } from "../../lib/desktop";
import type { EntryId, VaultSnapshotDto } from "../../types/desktop";
import { EntryDetail } from "./EntryDetail";
import { EntryCreateDialog } from "./EntryCreateDialog";
import { EntryList } from "./EntryList";
import { GroupActions } from "./GroupActions";
import { GroupTree } from "./GroupTree";

interface UnlockedViewProps {
  api: DesktopApi;
  snapshot: VaultSnapshotDto;
  locking: boolean;
  lockError: string | null;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
  onLock: () => void;
}

export function UnlockedView({
  api,
  snapshot,
  locking,
  lockError,
  onSnapshot,
  onLock,
}: UnlockedViewProps) {
  const [selectedGroupId, setSelectedGroupId] = useState(snapshot.rootGroupId);
  const [selectedEntryId, setSelectedEntryId] = useState<EntryId | null>(null);
  const [creatingEntry, setCreatingEntry] = useState(false);
  const groupsById = useMemo(
    () => new Map(snapshot.groups.map((group) => [group.id, group])),
    [snapshot.groups],
  );
  const entriesById = useMemo(
    () => new Map(snapshot.entries.map((entry) => [entry.id, entry])),
    [snapshot.entries],
  );
  const selectedGroup =
    groupsById.get(selectedGroupId) ?? groupsById.get(snapshot.rootGroupId);

  if (selectedGroup === undefined) {
    throw new Error("Vault snapshot has no root group");
  }

  const entries = selectedGroup.entryIds.flatMap((id) => {
    const entry = entriesById.get(id);
    return entry === undefined ? [] : [entry];
  });

  const chooseGroup = (groupId: string) => {
    if (!groupsById.has(groupId)) {
      return;
    }
    setSelectedGroupId(groupId);
    setSelectedEntryId(null);
  };

  return (
    <main className="vault-shell">
      <header className="top-bar">
        <div className="product-lockup">
          <span className="brand-mark small" aria-hidden="true">
            N
          </span>
          <div>
            <p className="eyebrow">Nian Pass</p>
            <h1>Vault browser</h1>
            {snapshot.dirty ? (
              <p className="dirty-indicator" role="status">
                Unsaved changes
              </p>
            ) : null}
          </div>
        </div>
        <button
          className="secondary-button lock-button"
          type="button"
          disabled={locking}
          onClick={onLock}
        >
          {locking ? "Locking…" : "Lock"}
        </button>
      </header>
      <p className="shell-error" role="alert" aria-live="assertive">
        {lockError ?? ""}
      </p>
      <div className="vault-layout">
        <div className="group-pane">
          <GroupTree
            rootGroupId={snapshot.rootGroupId}
            groupsById={groupsById}
            selectedGroupId={selectedGroup.id}
            onSelect={chooseGroup}
          />
          <GroupActions
            api={api}
            group={selectedGroup}
            snapshot={snapshot}
            disabled={locking}
            onChanged={(next, nextGroupId) => {
              setSelectedEntryId(null);
              setSelectedGroupId(nextGroupId);
              onSnapshot(next);
            }}
          />
        </div>
        <div className="entry-column">
          <button
            type="button"
            disabled={locking}
            onClick={() => {
              setCreatingEntry(true);
            }}
          >
            New entry
          </button>
          <EntryList
            group={selectedGroup}
            entries={entries}
            selectedEntryId={selectedEntryId}
            onSelect={setSelectedEntryId}
          />
        </div>
        {selectedEntryId === null ? (
          <aside className="detail-pane detail-empty" aria-label="Entry detail">
            Select an entry to view its safe details.
          </aside>
        ) : (
          <EntryDetail
            key={selectedEntryId}
            api={api}
            entryId={selectedEntryId}
            groups={snapshot.groups}
            disabled={locking}
            onSnapshot={onSnapshot}
            onDeleted={(next) => {
              setSelectedEntryId(null);
              onSnapshot(next);
            }}
            onMoved={(next, destination) => {
              setSelectedGroupId(destination);
              onSnapshot(next);
            }}
          />
        )}
      </div>
      {creatingEntry && !locking ? (
        <EntryCreateDialog
          api={api}
          groupId={selectedGroup.id}
          onCancel={() => {
            setCreatingEntry(false);
          }}
          onCreated={(result) => {
            setCreatingEntry(false);
            setSelectedEntryId(result.createdEntryId);
            onSnapshot(result.snapshot);
          }}
        />
      ) : null}
    </main>
  );
}
