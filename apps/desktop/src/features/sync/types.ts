import type { DesktopApi } from "../../lib/desktop";
import type { VaultSnapshotDto } from "../../types/desktop";

export type ProviderKind = "webdav" | "s3" | "gateway";

export interface SyncSectionOptions {
  api: DesktopApi;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
}
