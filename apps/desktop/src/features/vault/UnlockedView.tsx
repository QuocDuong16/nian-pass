import { useMemo, useState } from "react";

import type { DesktopApi } from "../../lib/desktop";
import type { EntryId, VaultSnapshotDto } from "../../types/desktop";
import { EntryCreateDialog } from "./EntryCreateDialog";
import { EntryDetail } from "./EntryDetail";
import { GroupActions } from "./GroupActions";
import { GroupTree } from "./GroupTree";
import { VaultEntryPane } from "./VaultEntryPane";
import {
  VaultReadOnlyNotice,
  VaultSettingsDialog,
  VaultStatusBar,
  VaultTopBar,
} from "./VaultChrome";
import { useSaveShortcut } from "./useSaveShortcut";
import { useSecurityFormTelemetry } from "./useSecurityFormTelemetry";
import { useVaultSearch } from "./useVaultSearch";

interface UnlockedViewProps {
  api: DesktopApi;
  snapshot: VaultSnapshotDto;
  disabled: boolean;
  saveStatus: "idle" | "saving" | "saved";
  lockError: string | null;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
  onSave: () => void;
  onLock: () => void;
  autoLockMs?: number | null;
  onAutoLockChange?: (timeoutMs: number | null) => void;
  onDraftStateChange?: (hasDraft: boolean) => void;
  onMutationPendingChange?: (pending: boolean) => void;
  clearRevealsVersion?: number;
}

export function UnlockedView({
  api,
  snapshot,
  disabled,
  saveStatus,
  lockError,
  onSnapshot,
  onSave,
  onLock,
  autoLockMs = 5 * 60_000,
  onAutoLockChange,
  onDraftStateChange,
  onMutationPendingChange,
  clearRevealsVersion = 0,
}: UnlockedViewProps) {
  const [selectedGroupId, setSelectedGroupId] = useState(snapshot.rootGroupId);
  const [selectedEntryId, setSelectedEntryId] = useState<EntryId | null>(null);
  const [creatingEntry, setCreatingEntry] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [detailDraft, setDetailDraft] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [groupDraft, setGroupDraft] = useState(false);
  const [groupBusy, setGroupBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

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

  const hasDraft = creatingEntry || detailDraft || groupDraft;
  const mutationPending = createBusy || detailBusy || groupBusy || syncBusy;
  const readOnly = !snapshot.capabilities.writable;
  const mutationDisabled = disabled || readOnly;
  const searchResults = useVaultSearch(snapshot, groupsById, searchQuery);

  useSecurityFormTelemetry(
    hasDraft,
    mutationPending,
    onDraftStateChange,
    onMutationPendingChange,
  );

  if (selectedGroup === undefined) {
    throw new Error("Vault snapshot has no root group");
  }

  const groupEntries = selectedGroup.entryIds.flatMap((id) => {
    const entry = entriesById.get(id);
    return entry === undefined ? [] : [entry];
  });
  const entries = searchResults ?? groupEntries;

  const chooseGroup = (groupId: string) => {
    if (!groupsById.has(groupId)) return;
    setSearchQuery("");
    setSelectedGroupId(groupId);
    setSelectedEntryId(null);
    setDetailDraft(false);
  };

  const chooseEntry = (entryId: string) => {
    const entry = entriesById.get(entryId);
    if (entry === undefined) return;
    setSelectedGroupId(entry.groupId);
    setSelectedEntryId(entry.id);
    setDetailDraft(false);
  };

  const saveUnavailable =
    disabled || readOnly || mutationPending || !snapshot.dirty || hasDraft;

  useSaveShortcut({
    blocked: saveUnavailable,
    settingsOpen,
    onSave,
  });

  return (
    <main className="vault-shell">
      <VaultTopBar
        snapshot={snapshot}
        searchQuery={searchQuery}
        saveStatus={saveStatus}
        saveUnavailable={saveUnavailable}
        hasDraft={hasDraft}
        disabled={disabled}
        mutationPending={mutationPending}
        onSearch={setSearchQuery}
        onSave={onSave}
        onLock={onLock}
        onSettings={() => {
          setSettingsOpen(true);
        }}
      />
      <VaultReadOnlyNotice snapshot={snapshot} />
      <p className="shell-error" role="alert" aria-live="assertive">
        {lockError ?? ""}
      </p>

      <div className="vault-layout">
        <div className="group-pane">
          <div className="pane-heading">Groups</div>
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
            disabled={mutationDisabled}
            onChanged={(next, nextGroupId) => {
              setSelectedEntryId(null);
              setSelectedGroupId(nextGroupId);
              onSnapshot(next);
            }}
            onDraftChange={setGroupDraft}
            onBusyChange={setGroupBusy}
          />
        </div>

        <VaultEntryPane
          group={selectedGroup}
          entries={entries}
          selectedEntryId={selectedEntryId}
          searchActive={searchResults !== null}
          disabled={mutationDisabled}
          onNewEntry={() => {
            setCreatingEntry(true);
          }}
          onSelectEntry={chooseEntry}
        />

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
            disabled={disabled}
            mutationDisabled={readOnly}
            onDraftChange={setDetailDraft}
            onBusyChange={setDetailBusy}
            clearRevealsVersion={clearRevealsVersion}
            onSnapshot={onSnapshot}
            onDeleted={(next) => {
              setSelectedEntryId(null);
              setDetailDraft(false);
              onSnapshot(next);
            }}
            onMoved={(next, destination) => {
              setSelectedGroupId(destination);
              onSnapshot(next);
            }}
          />
        )}
      </div>

      <VaultStatusBar snapshot={snapshot} />

      {settingsOpen ? (
        <VaultSettingsDialog
          api={api}
          snapshot={snapshot}
          disabled={disabled}
          hasDraft={hasDraft}
          mutationPending={mutationPending}
          autoLockMs={autoLockMs}
          onAutoLockChange={onAutoLockChange}
          onBusyChange={setSyncBusy}
          onSnapshot={onSnapshot}
          onClose={() => {
            setSettingsOpen(false);
          }}
        />
      ) : null}

      {creatingEntry && !mutationDisabled ? (
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
          onBusyChange={setCreateBusy}
        />
      ) : null}
    </main>
  );
}
