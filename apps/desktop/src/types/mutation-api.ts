import type {
  CreatedEntryBaseDto,
  CreatedGroupBaseDto,
  CreateEntryRequest,
  EntryId,
  GroupId,
  SetCustomFieldRequest,
  UpdateEntryRequest,
  VaultCoreSnapshotDto,
  VaultSnapshotDto,
} from "./desktop";

export interface EntryEditApi<
  TSnapshot extends VaultCoreSnapshotDto = VaultSnapshotDto,
> {
  updateEntry: (request: UpdateEntryRequest) => Promise<TSnapshot>;
  revealEntryTitle: (entryId: EntryId) => Promise<string>;
  revealEntryUsername: (entryId: EntryId) => Promise<string>;
  revealEntryUrl: (entryId: EntryId) => Promise<string>;
  revealEntryNotes: (entryId: EntryId) => Promise<string>;
}

export interface CustomFieldEditorApi<
  TSnapshot extends VaultCoreSnapshotDto = VaultSnapshotDto,
> {
  revealEntryCustomField: (entryId: EntryId, name: string) => Promise<string>;
  setEntryCustomField: (request: SetCustomFieldRequest) => Promise<TSnapshot>;
  deleteEntryCustomField: (
    entryId: EntryId,
    name: string,
  ) => Promise<TSnapshot>;
}

export interface EntryActionsApi<
  TSnapshot extends VaultCoreSnapshotDto = VaultSnapshotDto,
> {
  deleteEntry: (entryId: EntryId) => Promise<TSnapshot>;
  moveEntry: (
    entryId: EntryId,
    destinationGroupId: GroupId,
  ) => Promise<TSnapshot>;
}

export interface EntryCreateApi<
  TSnapshot extends VaultCoreSnapshotDto = VaultSnapshotDto,
> {
  createEntry: (
    request: CreateEntryRequest,
  ) => Promise<CreatedEntryBaseDto<TSnapshot>>;
}

export interface GroupActionsApi<
  TSnapshot extends VaultCoreSnapshotDto = VaultSnapshotDto,
> {
  createGroup: (
    parentGroupId: GroupId,
    name: string,
  ) => Promise<CreatedGroupBaseDto<TSnapshot>>;
  renameGroup: (groupId: GroupId, name: string) => Promise<TSnapshot>;
  moveGroup: (
    groupId: GroupId,
    destinationGroupId: GroupId,
  ) => Promise<TSnapshot>;
  deleteGroup: (groupId: GroupId) => Promise<TSnapshot>;
}
