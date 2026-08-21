export type SummaryTextDto =
  | { kind: "missing" }
  | { kind: "visible"; value: string }
  | { kind: "protected" };

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
  id: string;
  groupId: string;
  title: SummaryTextDto;
  username: SummaryTextDto;
  url: SummaryTextDto;
  passwordPresent: boolean;
  notesPresent: boolean;
  tags: string[];
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
  | "internal";
