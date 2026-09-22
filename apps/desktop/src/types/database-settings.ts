import type { VaultSnapshotDto } from "./desktop";

export interface DatabaseMetadataDto {
  name: string;
  description: string;
  defaultUsername: string;
}

export interface DatabaseMetadataUpdateReceiptDto {
  metadata: DatabaseMetadataDto;
  snapshot: VaultSnapshotDto;
}

export interface HistoryPolicyDto {
  maxItems: number | null;
  maximumEditableItems: number;
}

export interface HistoryPolicyUpdateReceiptDto {
  policy: HistoryPolicyDto;
  snapshot: VaultSnapshotDto;
}
