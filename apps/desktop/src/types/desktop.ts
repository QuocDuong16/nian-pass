export type SummaryTextDto =
  | { kind: "missing" }
  | { kind: "visible"; value: string }
  | { kind: "protected" };

export type EntryId = string;
export type GroupId = string;

export interface SelectedVaultDto {
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
  tags: string[];
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
  customFields: CustomFieldSummaryDto[];
}

export interface ClipboardReceiptDto {
  copied: true;
  expiresInMs: number;
}

export interface LockResultDto {
  clipboard: "cleared" | "not_owned" | "clear_failed";
}

export interface VaultSnapshotDto {
  dirty: boolean;
  rootGroupId: string;
  groups: GroupDto[];
  entries: EntrySummaryDto[];
}

export interface CreatedEntryDto {
  createdEntryId: EntryId;
  snapshot: VaultSnapshotDto;
}

export interface CreatedGroupDto {
  createdGroupId: GroupId;
  snapshot: VaultSnapshotDto;
}

export interface UpdateEntryRequest {
  entryId: EntryId;
  title?: string;
  username?: string;
  url?: string;
  password?: string;
  notes?: string;
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
  | "entry_not_found"
  | "group_not_found"
  | "invalid_request"
  | "invalid_move"
  | "reserved_field"
  | "secret_unavailable"
  | "unsaved_changes"
  | "clipboard_failed"
  | "internal";
