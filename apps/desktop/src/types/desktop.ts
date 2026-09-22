export type * from "./database-settings";

export type SummaryTextDto =
  | { kind: "missing" }
  | { kind: "visible"; value: string }
  | { kind: "protected" };

export type EntryIconDto =
  | { kind: "none" }
  | { kind: "built_in"; id: number }
  | { kind: "custom" }
  | { kind: "non_standard" };

export type EntryId = string;
export type GroupId = string;

export interface SelectedVaultDto {
  fileName: string;
}

export interface SelectedKeyfileDto {
  fileName: string;
}

export interface GroupDto {
  id: string;
  name: string;
  childGroupIds: string[];
  entryIds: string[];
}

export interface EntrySummaryDto {
  id: EntryId;
  groupId: string;
  title: SummaryTextDto;
  username: SummaryTextDto;
  url: SummaryTextDto;
  passwordPresent: boolean;
  notesPresent: boolean;
  totpPresent: boolean;
  tags: string[];
  expiresAtUnixSeconds: number | null;
  icon: EntryIconDto;
}

export interface CustomFieldSummaryDto {
  name: string;
  protection: "protected" | "unprotected";
}

export interface EntryDetailDto {
  id: EntryId;
  title: SummaryTextDto;
  username: SummaryTextDto;
  url: SummaryTextDto;
  passwordPresent: boolean;
  notesPresent: boolean;
  totpPresent: boolean;
  tags: string[];
  expiresAtUnixSeconds: number | null;
  icon: EntryIconDto;
  customFields: CustomFieldSummaryDto[];
}

export interface TotpCodeDto {
  code: string;
  validForSeconds: number;
  periodSeconds: number;
}

export interface EntryHistoryItemDto {
  index: number;
  modifiedAtUnixSeconds: number | null;
  title: SummaryTextDto;
  username: SummaryTextDto;
  url: SummaryTextDto;
  passwordPresent: boolean;
  notesPresent: boolean;
  totpPresent: boolean;
  tags: string[];
  expiresAtUnixSeconds: number | null;
  restorable: boolean;
}

export interface EntryHistoryDto {
  documentRevision: string;
  items: EntryHistoryItemDto[];
}

export interface EntryAttachmentSummaryDto {
  name: string;
  sizeBytes: number;
  protected: boolean;
}

export interface AttachmentExportReceiptDto {
  exported: true;
}

export interface PasswordHealthIssueDto {
  entryId: EntryId;
  groupId: GroupId;
  title: SummaryTextDto;
  missingPassword: boolean;
  emptyPassword: boolean;
  reusedPassword: boolean;
  belowMinimumLength: boolean;
  weakPassword: boolean;
  strengthScore: number | null;
}

export interface PasswordHealthReportDto {
  totalEntries: number;
  passwordEntries: number;
  minimumLength: number;
  weakScoreThreshold: number;
  issues: PasswordHealthIssueDto[];
}

export interface ClipboardReceiptDto {
  copied: true;
  expiresInMs: number;
}

export interface LockResultDto {
  clipboard: "cleared" | "not_owned" | "clear_failed";
}

export interface VaultCoreSnapshotDto {
  dirty: boolean;
  recycleBinEnabled: boolean;
  recycleBinGroupId: GroupId | null;
  rootGroupId: string;
  groups: GroupDto[];
  entries: EntrySummaryDto[];
}

export type WriteRestriction =
  | "unsupported_write_format"
  | "unsupported_persistence_platform"
  | "read_only_source";

export interface VaultCapabilitiesDto {
  formatVersion: string;
  writable: boolean;
  writeRestriction: WriteRestriction | null;
}

export interface VaultSnapshotDto extends VaultCoreSnapshotDto {
  fileName: string;
  capabilities: VaultCapabilitiesDto;
}

export interface CreatedEntryBaseDto<
  TSnapshot extends VaultCoreSnapshotDto = VaultCoreSnapshotDto,
> {
  createdEntryId: EntryId;
  snapshot: TSnapshot;
}

export interface CreatedGroupBaseDto<
  TSnapshot extends VaultCoreSnapshotDto = VaultCoreSnapshotDto,
> {
  createdGroupId: GroupId;
  snapshot: TSnapshot;
}

export type CreatedEntryDto = CreatedEntryBaseDto<VaultSnapshotDto>;
export type CreatedGroupDto = CreatedGroupBaseDto<VaultSnapshotDto>;

export interface UpdateEntryRequest {
  entryId: EntryId;
  title?: string;
  username?: string;
  url?: string;
  password?: string;
  notes?: string;
  expires?: boolean;
  expiryUnixSeconds?: number;
  totpEnabled?: boolean;
  totpUri?: string;
  icon?: { kind: "none" } | { kind: "built_in"; id: number };
}

export interface CreateEntryRequest {
  groupId: GroupId;
  title: string;
  username: string;
  url: string;
  password: string | null;
  notes: string | null;
}

export interface SetCustomFieldRequest {
  entryId: EntryId;
  name: string;
  value: string;
  protection: "protected" | "unprotected";
}

export interface ClosePolicyDto {
  policy: "allow" | "confirm_discard";
}

export type DesktopErrorCode =
  | "already_unlocked"
  | "locked"
  | "no_vault_selected"
  | "unlock_failed"
  | "unsupported_vault"
  | "vault_create_failed"
  | "vault_already_exists"
  | "entry_not_found"
  | "group_not_found"
  | "invalid_request"
  | "invalid_move"
  | "history_changed"
  | "history_restore_unsupported"
  | "attachment_not_found"
  | "attachment_already_exists"
  | "attachment_too_large"
  | "attachment_io_failed"
  | "reserved_field"
  | "secret_unavailable"
  | "unsaved_changes"
  | "save_failed"
  | "save_authentication_failed"
  | "save_uncertain"
  | "unsupported_write_format"
  | "unsupported_persistence_platform"
  | "read_only_source"
  | "external_change"
  | "reload_failed"
  | "clipboard_failed"
  | "internal"
  | "operation_in_progress"
  | "sync_failed"
  | "sync_remote_changed"
  | "sync_local_changed"
  | "sync_local_changed_during_recovery"
  | "sync_recovery_required"
  | "sync_state_unsupported"
  | "sync_state_corrupt"
  | "sync_unsupported_provider"
  | "sync_unsafe_provider"
  | "sync_credentials_required";
