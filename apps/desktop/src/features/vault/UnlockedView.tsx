import { useMemo, useState } from "react";

import type { VaultSnapshotDto } from "../../types/desktop";
import { EntryList } from "./EntryList";
import { GroupTree } from "./GroupTree";

interface UnlockedViewProps {
  snapshot: VaultSnapshotDto;
  locking: boolean;
  lockError: string | null;
  onLock: () => Promise<void>;
}

export function UnlockedView({ snapshot, locking, lockError, onLock }: UnlockedViewProps) {
  const [selectedGroupId, setSelectedGroupId] = useState(snapshot.rootGroupId);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const groupsById = useMemo(
    () => new Map(snapshot.groups.map((group) => [group.id, group])),
    [snapshot.groups],
  );
  const entriesById = useMemo(
    () => new Map(snapshot.entries.map((entry) => [entry.id, entry])),
    [snapshot.entries],
  );
  const selectedGroup = groupsById.get(selectedGroupId) ?? groupsById.get(snapshot.rootGroupId);

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
          <span className="brand-mark small" aria-hidden="true">N</span>
          <div>
            <p className="eyebrow">Nian Pass</p>
            <h1>Vault browser</h1>
          </div>
        </div>
        <button className="secondary-button lock-button" type="button" disabled={locking} onClick={() => void onLock()}>
          {locking ? "Locking…" : "Lock"}
        </button>
      </header>
      <p className="shell-error" role="alert" aria-live="assertive">{lockError ?? ""}</p>
      <div className="vault-layout">
        <GroupTree
          rootGroupId={snapshot.rootGroupId}
          groupsById={groupsById}
          selectedGroupId={selectedGroup.id}
          onSelect={chooseGroup}
        />
        <EntryList
          group={selectedGroup}
          entries={entries}
          selectedEntryId={selectedEntryId}
          onSelect={setSelectedEntryId}
        />
      </div>
    </main>
  );
}
