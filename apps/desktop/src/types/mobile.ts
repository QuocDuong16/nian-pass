import type {
  CreatedEntryDto,
  CreatedGroupDto,
  CreateEntryRequest,
  EntryDetailDto,
  EntryId,
  GroupId,
  SetCustomFieldRequest,
  UpdateEntryRequest,
  VaultSnapshotDto,
} from "./desktop";

export interface MobileSelectedVaultDto {
  fileName: string;
  writable: boolean;
}

export type MobileErrorCode =
  | "picker_failed"
  | "no_vault_selected"
  | "unlock_failed"
  | "unsupported_vault"
  | "entry_not_found"
  | "group_not_found"
  | "invalid_request"
  | "conflict"
  | "secret_unavailable"
  | "locked"
  | "unsaved_changes"
  | "busy"
  | "save_failed"
  | "save_authentication_failed"
  | "external_change"
  | "save_uncertain"
  | "persistence_unsupported"
  | "recovery_required"
  | "reload_failed"
  | "reload_authentication_failed"
  | "internal";

export interface MobileApi {
  selectVault: () => Promise<MobileSelectedVaultDto | null>;
  unlockVault: (password: string) => Promise<VaultSnapshotDto>;
  getVaultSnapshot: () => Promise<VaultSnapshotDto>;
  getEntryDetail: (entryId: EntryId) => Promise<EntryDetailDto>;
  revealEntryTitle: (entryId: EntryId) => Promise<string>;
  revealEntryUsername: (entryId: EntryId) => Promise<string>;
  revealEntryUrl: (entryId: EntryId) => Promise<string>;
  revealEntryNotes: (entryId: EntryId) => Promise<string>;
  revealEntryCustomField: (entryId: EntryId, name: string) => Promise<string>;
  updateEntry: (request: UpdateEntryRequest) => Promise<VaultSnapshotDto>;
  createEntry: (request: CreateEntryRequest) => Promise<CreatedEntryDto>;
  deleteEntry: (entryId: EntryId) => Promise<VaultSnapshotDto>;
  moveEntry: (
    entryId: EntryId,
    destinationGroupId: GroupId,
  ) => Promise<VaultSnapshotDto>;
  createGroup: (
    parentGroupId: GroupId,
    name: string,
  ) => Promise<CreatedGroupDto>;
  renameGroup: (groupId: GroupId, name: string) => Promise<VaultSnapshotDto>;
  moveGroup: (
    groupId: GroupId,
    destinationGroupId: GroupId,
  ) => Promise<VaultSnapshotDto>;
  deleteGroup: (groupId: GroupId) => Promise<VaultSnapshotDto>;
  setEntryCustomField: (
    request: SetCustomFieldRequest,
  ) => Promise<VaultSnapshotDto>;
  deleteEntryCustomField: (
    entryId: EntryId,
    name: string,
  ) => Promise<VaultSnapshotDto>;
  saveVault: (password: string) => Promise<VaultSnapshotDto>;
  reloadVault: (password: string) => Promise<VaultSnapshotDto>;
  lockVault: () => Promise<void>;
  discardChangesAndLock: () => Promise<void>;
}
