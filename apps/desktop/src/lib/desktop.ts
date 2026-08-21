import { invoke } from "@tauri-apps/api/core";

import type {
  DesktopErrorCode,
  SelectedVaultDto,
  VaultSnapshotDto,
} from "../types/desktop";
import {
  parseDesktopErrorCode,
  parseNull,
  parseSelectedVault,
  parseVaultSnapshot,
} from "./validation";

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

function toDesktopError(error: unknown): DesktopCommandError {
  if (error instanceof DesktopCommandError) return error;
  if (typeof error === "object" && error !== null && "code" in error) {
    try {
      return new DesktopCommandError(
        parseDesktopErrorCode(Reflect.get(error, "code")),
      );
    } catch {
      return new DesktopCommandError("internal");
    }
  }
  return new DesktopCommandError("internal");
}

async function call<T>(
  command: string,
  parse: (value: unknown) => T,
  args?: Record<string, unknown>,
): Promise<T> {
  let value: unknown;
  try {
    value = await invoke<unknown>(command, args);
  } catch (error: unknown) {
    throw toDesktopError(error);
  }
  try {
    return parse(value);
  } catch {
    throw new DesktopCommandError("internal");
  }
}

export const desktopApi: DesktopApi = {
  selectVault: () =>
    call("select_vault", (value) =>
      value === null ? null : parseSelectedVault(value),
    ),
  unlockVault: (password) =>
    call("unlock_vault", parseVaultSnapshot, { password }),
  getVaultSnapshot: () => call("vault_snapshot", parseVaultSnapshot),
  lockVault: async () => {
    await call("lock_vault", parseNull);
  },
};
