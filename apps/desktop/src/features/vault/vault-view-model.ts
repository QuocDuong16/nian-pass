import type {
  EntryId,
  EntrySummaryDto,
  GroupDto,
  VaultSnapshotDto,
} from "../../types/desktop";
import { isGroupInRecycleBin } from "./recycle-bin";

export interface VaultViewModel {
  groupEntries: EntrySummaryDto[];
  selectedGroupRecycled: boolean;
  selectedEntryRecycled: boolean;
  activeGroups: GroupDto[];
}

export function buildVaultViewModel(
  snapshot: VaultSnapshotDto,
  selectedGroup: GroupDto,
  entriesById: ReadonlyMap<EntryId, EntrySummaryDto>,
  selectedEntryId: EntryId | null,
): VaultViewModel {
  const groupEntries = selectedGroup.entryIds.flatMap((id) => {
    const entry = entriesById.get(id);
    return entry === undefined ? [] : [entry];
  });
  const selectedEntry =
    selectedEntryId === null ? undefined : entriesById.get(selectedEntryId);
  return {
    groupEntries,
    selectedGroupRecycled: isGroupInRecycleBin(snapshot, selectedGroup.id),
    selectedEntryRecycled:
      selectedEntry !== undefined &&
      isGroupInRecycleBin(snapshot, selectedEntry.groupId),
    activeGroups: snapshot.groups.filter(
      (group) => !isGroupInRecycleBin(snapshot, group.id),
    ),
  };
}
