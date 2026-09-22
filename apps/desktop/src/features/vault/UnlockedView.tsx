import { useMemo, useState } from "react";

import type { DesktopApi } from "../../lib/desktop";
import type { EntryId, VaultSnapshotDto } from "../../types/desktop";
import { EntryDetail } from "./EntryDetail";
import { VaultEmptyDetail } from "./VaultEmptyDetail";
import { VaultEntryPane } from "./VaultEntryPane";
import { VaultGroupPane } from "./VaultGroupPane";
import { VaultOverlays } from "./VaultOverlays";
import { VaultReadOnlyNotice, VaultStatusBar } from "./VaultChrome";
import { VaultToolbar } from "./VaultToolbar";
import { useSecurityFormTelemetry } from "./useSecurityFormTelemetry";
import { useVaultBulkActions } from "./useVaultBulkActions";
import { useVaultNavigation } from "./useVaultNavigation";
import { useVaultSearch } from "./useVaultSearch";
import { buildVaultViewModel } from "./vault-view-model";
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
  const readOnly = !snapshot.capabilities.writable;
  const mutationDisabled = disabled || readOnly;
  const searchResults = useVaultSearch(snapshot, groupsById, searchQuery);
  const navigation = useVaultNavigation({
    groupsById,
    entriesById,
    setSearchQuery,
    setSelectedGroupId,
    setSelectedEntryId,
    setDetailDraft,
    onSnapshot,
  });
  const bulk = useVaultBulkActions({
    onClearEntry: navigation.clearEntry,
    onSelectGroup: navigation.selectGroup,
    onSnapshot,
  });
  const mutationPending =
    createBusy || detailBusy || groupBusy || syncBusy || bulk.busy;
  useSecurityFormTelemetry(
    hasDraft,
    mutationPending,
    onDraftStateChange,
    onMutationPendingChange,
  );

  if (selectedGroup === undefined) {
    throw new Error("Vault snapshot has no root group");
  }

  const {
    groupEntries,
    selectedGroupRecycled,
    selectedEntryRecycled,
    activeGroups,
  } = buildVaultViewModel(
    snapshot,
    selectedGroup,
    entriesById,
    selectedEntryId,
  );
  const saveUnavailable =
    disabled || readOnly || mutationPending || !snapshot.dirty || hasDraft;

  return (
    <main className="vault-shell">
      <VaultToolbar
        api={api}
        privacyVersion={clearRevealsVersion}
        settingsOpen={settingsOpen}
        snapshot={snapshot}
        searchQuery={searchQuery}
        saveStatus={saveStatus}
        saveUnavailable={saveUnavailable}
        hasDraft={hasDraft}
        disabled={disabled}
        mutationPending={mutationPending}
        shortcutsDisabled={
          disabled || settingsOpen || hasDraft || mutationPending
        }
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
        <VaultGroupPane
          api={api}
          snapshot={snapshot}
          groupsById={groupsById}
          group={selectedGroup}
          disabled={mutationDisabled}
          onSelect={navigation.chooseGroup}
          onChanged={navigation.onGroupChanged}
          onDraftChange={setGroupDraft}
          onBusyChange={setGroupBusy}
        />

        <VaultEntryPane
          key={`${selectedGroup.id}:${searchResults === null ? "group" : "search"}`}
          api={api}
          group={selectedGroup}
          entries={searchResults ?? groupEntries}
          activeGroups={activeGroups}
          selectedEntryId={selectedEntryId}
          searchActive={searchResults !== null}
          disabled={mutationDisabled || selectedGroupRecycled}
          bulkDisabled={mutationDisabled || hasDraft || mutationPending}
          recycled={selectedGroupRecycled}
          recycleBinEnabled={snapshot.recycleBinEnabled}
          onNewEntry={() => {
            setCreatingEntry(true);
          }}
          onSelectEntry={navigation.chooseEntry}
          onSelectionStart={bulk.onSelectionStart}
          onBusyChange={bulk.onBusyChange}
          onBulkChanged={bulk.onChanged}
        />

        {selectedEntryId === null ? (
          <VaultEmptyDetail />
        ) : (
          <EntryDetail
            api={api}
            entryId={selectedEntryId}
            groups={activeGroups}
            disabled={disabled}
            mutationDisabled={readOnly}
            recycled={selectedEntryRecycled}
            recycleBinEnabled={snapshot.recycleBinEnabled}
            onDraftChange={setDetailDraft}
            onBusyChange={setDetailBusy}
            clearRevealsVersion={clearRevealsVersion}
            onSnapshot={onSnapshot}
            onDeleted={(next) => {
              setSelectedEntryId(null);
              setDetailDraft(false);
              onSnapshot(next);
            }}
            onDuplicated={(result) => {
              setSelectedEntryId(result.createdEntryId);
              onSnapshot(result.snapshot);
            }}
            onMoved={(next, destination) => {
              setSelectedGroupId(destination);
              onSnapshot(next);
            }}
          />
        )}
      </div>

      <VaultStatusBar snapshot={snapshot} />
      <VaultOverlays
        api={api}
        snapshot={snapshot}
        settingsOpen={settingsOpen}
        disabled={disabled}
        hasDraft={hasDraft}
        mutationPending={mutationPending}
        autoLockMs={autoLockMs}
        creatingEntry={creatingEntry}
        createAllowed={!mutationDisabled && !selectedGroupRecycled}
        selectedGroupId={selectedGroup.id}
        onAutoLockChange={onAutoLockChange}
        onSyncBusy={setSyncBusy}
        onCreateBusy={setCreateBusy}
        onSnapshot={onSnapshot}
        onCloseSettings={() => {
          setSettingsOpen(false);
        }}
        onCancelCreate={() => {
          setCreatingEntry(false);
        }}
        onCreated={(result) => {
          setCreatingEntry(false);
          setSelectedEntryId(result.createdEntryId);
          onSnapshot(result.snapshot);
        }}
      />
    </main>
  );
}
