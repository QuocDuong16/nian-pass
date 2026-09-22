import type {
  AttachmentExportReceiptDto,
  ClipboardReceiptDto,
  ClosePolicyDto,
  CreateEntryRequest,
  DatabaseMetadataDto,
  DatabaseMetadataUpdateReceiptDto,
  CreatedEntryDto,
  CreatedGroupDto,
  EntryAttachmentSummaryDto,
  EntryDetailDto,
  EntryHistoryDto,
  EntryId,
  GroupId,
  HistoryPolicyDto,
  HistoryPolicyUpdateReceiptDto,
  LockResultDto,
  PasswordHealthReportDto,
  SelectedKeyfileDto,
  SelectedVaultDto,
  SetCustomFieldRequest,
  TotpCodeDto,
  UpdateEntryRequest,
  VaultSnapshotDto,
} from "../types/desktop";
import type { RuntimeInfoDto } from "../types/runtime";
import type { SyncApi } from "./sync-api";

export interface RuntimeApi {
  getInfo: () => Promise<RuntimeInfoDto>;
}

export interface DesktopApi extends SyncApi {
  selectVault: () => Promise<SelectedVaultDto | null>;
  selectKeyfile: () => Promise<SelectedKeyfileDto | null>;
  clearKeyfile: () => Promise<void>;
  credentialHasKeyfile: () => Promise<boolean>;
  credentialHasPassword: () => Promise<boolean>;
  replaceKeyfile: () => Promise<SelectedKeyfileDto | null>;
  removeKeyfile: () => Promise<void>;
  createVault: (
    vaultName: string,
    password: string,
  ) => Promise<VaultSnapshotDto | null>;
  unlockVault: (password: string) => Promise<VaultSnapshotDto>;
  unlockVaultWithKeyfile: (
    password: string | null,
  ) => Promise<VaultSnapshotDto>;
  getVaultSnapshot: () => Promise<VaultSnapshotDto>;
  saveVault: () => Promise<VaultSnapshotDto>;
  exportVaultCopy: () => Promise<boolean>;
  changeMasterPassword: (newPassword: string) => Promise<VaultSnapshotDto>;
  removeMasterPassword: () => Promise<VaultSnapshotDto>;
  getDatabaseMetadata: () => Promise<DatabaseMetadataDto>;
  updateDatabaseMetadata: (
    name: string,
    description: string,
    defaultUsername: string,
  ) => Promise<DatabaseMetadataUpdateReceiptDto>;
  getHistoryPolicy: () => Promise<HistoryPolicyDto>;
  setHistoryMaxItems: (
    maxItems: number | null,
  ) => Promise<HistoryPolicyUpdateReceiptDto>;
  setRecycleBinEnabled: (enabled: boolean) => Promise<VaultSnapshotDto>;
  reloadVault: (password: string | null) => Promise<VaultSnapshotDto>;
  getPasswordHealthReport: () => Promise<PasswordHealthReportDto>;
  getEntryDetail: (entryId: EntryId) => Promise<EntryDetailDto>;
  getEntryAttachments: (
    entryId: EntryId,
  ) => Promise<EntryAttachmentSummaryDto[]>;
  importEntryCustomIcon: (entryId: EntryId) => Promise<VaultSnapshotDto | null>;
  importEntryAttachment: (entryId: EntryId) => Promise<VaultSnapshotDto | null>;
  exportEntryAttachment: (
    entryId: EntryId,
    name: string,
  ) => Promise<AttachmentExportReceiptDto | null>;
  getEntryHistory: (entryId: EntryId) => Promise<EntryHistoryDto>;
  restoreEntryHistory: (
    entryId: EntryId,
    historyIndex: number,
    expectedDocumentRevision: string,
  ) => Promise<VaultSnapshotDto>;
  revealEntryPassword: (entryId: EntryId) => Promise<string>;
  revealEntryNotes: (entryId: EntryId) => Promise<string>;
  revealEntryTotp: (entryId: EntryId) => Promise<TotpCodeDto>;
  revealEntryTitle: (entryId: EntryId) => Promise<string>;
  revealEntryUsername: (entryId: EntryId) => Promise<string>;
  revealEntryUrl: (entryId: EntryId) => Promise<string>;
  openEntryUrl: (entryId: EntryId) => Promise<void>;
  revealEntryCustomField: (entryId: EntryId, name: string) => Promise<string>;
  copyEntryCustomField: (
    entryId: EntryId,
    name: string,
  ) => Promise<ClipboardReceiptDto>;
  copyEntryTitle: (entryId: EntryId) => Promise<ClipboardReceiptDto>;
  copyEntryUsername: (entryId: EntryId) => Promise<ClipboardReceiptDto>;
  copyEntryUrl: (entryId: EntryId) => Promise<ClipboardReceiptDto>;
  copyEntryNotes: (entryId: EntryId) => Promise<ClipboardReceiptDto>;
  copyEntryPassword: (entryId: EntryId) => Promise<ClipboardReceiptDto>;
  copyGeneratedPassword: (password: string) => Promise<ClipboardReceiptDto>;
  copyEntryTotp: (entryId: EntryId) => Promise<ClipboardReceiptDto>;
  updateEntry: (request: UpdateEntryRequest) => Promise<VaultSnapshotDto>;
  setEntryTags: (entryId: EntryId, tags: string[]) => Promise<VaultSnapshotDto>;
  createEntry: (request: CreateEntryRequest) => Promise<CreatedEntryDto>;
  duplicateEntry: (entryId: EntryId) => Promise<CreatedEntryDto>;
  deleteEntry: (entryId: EntryId) => Promise<VaultSnapshotDto>;
  restoreEntry: (entryId: EntryId) => Promise<VaultSnapshotDto>;
  permanentlyDeleteEntry: (entryId: EntryId) => Promise<VaultSnapshotDto>;
  moveEntry: (
    entryId: EntryId,
    destinationGroupId: GroupId,
  ) => Promise<VaultSnapshotDto>;
  moveEntries: (
    entryIds: EntryId[],
    destinationGroupId: GroupId,
  ) => Promise<VaultSnapshotDto>;
  trashEntries: (entryIds: EntryId[]) => Promise<VaultSnapshotDto>;
  restoreEntries: (entryIds: EntryId[]) => Promise<VaultSnapshotDto>;
  permanentlyDeleteEntries: (entryIds: EntryId[]) => Promise<VaultSnapshotDto>;
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
  restoreGroup: (groupId: GroupId) => Promise<VaultSnapshotDto>;
  permanentlyDeleteGroup: (groupId: GroupId) => Promise<VaultSnapshotDto>;
  setEntryCustomField: (
    request: SetCustomFieldRequest,
  ) => Promise<VaultSnapshotDto>;
  deleteEntryCustomField: (
    entryId: EntryId,
    name: string,
  ) => Promise<VaultSnapshotDto>;
  closePolicy: () => Promise<ClosePolicyDto>;
  lockVault: () => Promise<LockResultDto>;
  discardChangesAndLock: () => Promise<LockResultDto>;
}
