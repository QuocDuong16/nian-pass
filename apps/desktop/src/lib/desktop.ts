import { invoke } from "@tauri-apps/api/core";

import type {
  DesktopErrorCode,
  SelectedVaultDto,
  VaultSnapshotDto,
} from "../types/desktop";

export interface DesktopApi {
  selectVault: () => Promise<SelectedVaultDto | null>;
  unlockVault: (password: string) => Promise<VaultSnapshotDto>;
  getVaultSnapshot: () => Promise<VaultSnapshotDto>;
  lockVault: () => Promise<void>;
}

export class DesktopCommandError extends Error {
  readonly code: DesktopErrorCode;

  constructor(code: DesktopErrorCode) {
    super("Nian Pass desktop command failed");
    this.name = "DesktopCommandError";
    this.code = code;
  }
}

const knownErrorCodes = new Set<DesktopErrorCode>([
  "already_unlocked",
  "locked",
  "no_vault_selected",
  "unlock_failed",
  "unsupported_vault",
  "internal",
]);

function toDesktopError(error: unknown): DesktopCommandError {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = Reflect.get(error, "code");
    if (typeof code === "string" && knownErrorCodes.has(code as DesktopErrorCode)) {
      return new DesktopCommandError(code as DesktopErrorCode);
    }
  }
  return new DesktopCommandError("internal");
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error: unknown) {
    throw toDesktopError(error);
  }
}

export const desktopApi: DesktopApi = {
  selectVault: () => call<SelectedVaultDto | null>("select_vault"),
  unlockVault: (password) => call<VaultSnapshotDto>("unlock_vault", { password }),
  getVaultSnapshot: () => call<VaultSnapshotDto>("vault_snapshot"),
  lockVault: async () => {
    await call<null>("lock_vault");
  },
};
