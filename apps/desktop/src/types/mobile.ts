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
  SummaryTextDto,
} from "./desktop";

export interface MobileSelectedVaultDto {
  fileName: string;
  writable: boolean;
}

export type MobileErrorCode =
  | "picker_failed"
  | "source_unavailable"
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
  | "autofill_unavailable"
  | "autofill_not_configured"
  | "autofill_refresh_failed"
  | "credential_unavailable"
  | "internal";

export interface MobileAutofillStatusDto {
  supported: boolean;
  sourceEnabled: boolean;
  providerSelected: boolean;
}

export interface MobileAutofillRequestDto {
  requestToken: string;
  kind: "credential_query" | "credential_fulfillment" | "autofill";
  targetDisplay: string;
  requiresConfirmation: boolean;
  selectedEntryId: string | null;
}

export interface MobileAutofillLaunchDto {
  request: MobileAutofillRequestDto;
  selectedVault: MobileSelectedVaultDto | null;
}

export interface AutofillCandidateDto {
  entryId: EntryId;
  title: SummaryTextDto;
  username: SummaryTextDto;
}

export interface MobileSecurityResumeDto {
  foreground: boolean;
  elapsedRealtimeMs: number;
  generation: number;
  screenState: "active" | "screen_off" | "device_locked";
  curtainVisible: boolean;
  vaultState: "locked" | "clean" | "dirty";
  operationPending: boolean;
}

export interface MobileSecurityAcknowledgementDto {
  acknowledged: boolean;
}

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
  securityResume: () => Promise<MobileSecurityResumeDto>;
  acknowledgeSafeUi: (
    generation: number,
  ) => Promise<MobileSecurityAcknowledgementDto>;
  getAutofillStatus: () => Promise<MobileAutofillStatusDto>;
  enableAutofill: () => Promise<MobileAutofillStatusDto>;
  disableAutofill: () => Promise<MobileAutofillStatusDto>;
  refreshAutofill: () => Promise<MobileAutofillStatusDto>;
  getAutofillRequest: () => Promise<MobileAutofillLaunchDto | null>;
  getAutofillCandidates: (
    requestToken: string,
  ) => Promise<AutofillCandidateDto[]>;
  publishAutofillCandidates: (requestToken: string) => Promise<void>;
  approveAutofill: (
    requestToken: string,
    entryId: EntryId,
    approved: boolean,
  ) => Promise<void>;
  cancelAutofill: (requestToken: string) => Promise<void>;
  openAutofillSettings: () => Promise<void>;
}
