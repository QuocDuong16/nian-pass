import type { Dispatch, SetStateAction } from "react";

import type {
  EntryId,
  EntrySummaryDto,
  GroupDto,
  VaultSnapshotDto,
} from "../../types/desktop";

interface UseVaultNavigationOptions {
  groupsById: ReadonlyMap<string, GroupDto>;
  entriesById: ReadonlyMap<string, EntrySummaryDto>;
  setSearchQuery: Dispatch<SetStateAction<string>>;
  setSelectedGroupId: Dispatch<SetStateAction<string>>;
  setSelectedEntryId: Dispatch<SetStateAction<EntryId | null>>;
  setDetailDraft: Dispatch<SetStateAction<boolean>>;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
}

export function useVaultNavigation(options: UseVaultNavigationOptions) {
  const clearEntry = () => {
    options.setSelectedEntryId(null);
    options.setDetailDraft(false);
  };

  const chooseGroup = (groupId: string) => {
    if (!options.groupsById.has(groupId)) return;
    options.setSearchQuery("");
    options.setSelectedGroupId(groupId);
    clearEntry();
  };

  const chooseEntry = (entryId: string) => {
    const entry = options.entriesById.get(entryId);
    if (entry === undefined) return;
    options.setSelectedGroupId(entry.groupId);
    options.setSelectedEntryId(entry.id);
    options.setDetailDraft(false);
  };

  const onGroupChanged = (snapshot: VaultSnapshotDto, groupId: string) => {
    clearEntry();
    options.setSelectedGroupId(groupId);
    options.onSnapshot(snapshot);
  };

  return {
    clearEntry,
    chooseGroup,
    chooseEntry,
    onGroupChanged,
    selectGroup: options.setSelectedGroupId,
  };
}
