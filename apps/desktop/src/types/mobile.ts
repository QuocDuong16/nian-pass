import type {
  EntryDetailDto,
  EntryId,
  SelectedVaultDto,
  VaultSnapshotDto,
} from "./desktop";

export type MobileErrorCode =
  | "picker_failed"
  | "no_vault_selected"
  | "unlock_failed"
  | "unsupported_vault"
  | "entry_not_found"
  | "locked"
  | "internal";

export interface MobileApi {
  selectVault: () => Promise<SelectedVaultDto | null>;
  unlockVault: (password: string) => Promise<VaultSnapshotDto>;
  getVaultSnapshot: () => Promise<VaultSnapshotDto>;
  getEntryDetail: (entryId: EntryId) => Promise<EntryDetailDto>;
  lockVault: () => Promise<void>;
}
