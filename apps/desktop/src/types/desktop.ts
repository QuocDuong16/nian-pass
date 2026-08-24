export type SummaryTextDto =
  | { kind: "missing" }
  | { kind: "visible"; value: string }
  | { kind: "protected" };

export type EntryId = string;

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
  rootGroupId: string;
  groups: GroupDto[];
  entries: EntrySummaryDto[];
}

export type DesktopErrorCode =
  | "already_unlocked"
  | "locked"
  | "no_vault_selected"
  | "unlock_failed"
  | "unsupported_vault"
  | "entry_not_found"
  | "secret_unavailable"
  | "clipboard_failed"
  | "internal";
