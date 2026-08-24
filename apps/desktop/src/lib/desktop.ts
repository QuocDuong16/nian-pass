import { invoke } from "@tauri-apps/api/core";

import type {
  ClipboardReceiptDto,
  DesktopErrorCode,
  EntryDetailDto,
  EntryId,
  LockResultDto,
  SelectedVaultDto,
  VaultSnapshotDto,
} from "../types/desktop";
import {
  parseClipboardReceipt,
  parseEntryDetail,
  parseLockResult,
  parseSecretString,
} from "./entry-validation";
import {
  parseDesktopErrorCode,
  parseSelectedVault,
  parseVaultSnapshot,
} from "./validation";

export interface DesktopApi {
  selectVault: () => Promise<SelectedVaultDto | null>;
  unlockVault: (password: string) => Promise<VaultSnapshotDto>;
  getVaultSnapshot: () => Promise<VaultSnapshotDto>;
  getEntryDetail: (entryId: EntryId) => Promise<EntryDetailDto>;
  revealEntryPassword: (entryId: EntryId) => Promise<string>;
  revealEntryNotes: (entryId: EntryId) => Promise<string>;
  copyEntryUsername: (entryId: EntryId) => Promise<ClipboardReceiptDto>;
  copyEntryPassword: (entryId: EntryId) => Promise<ClipboardReceiptDto>;
  lockVault: () => Promise<LockResultDto>;
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
  getEntryDetail: (entryId) =>
    call("entry_detail", parseEntryDetail, { entryId }),
  revealEntryPassword: (entryId) =>
    call("reveal_entry_password", parseSecretString, { entryId }),
  revealEntryNotes: (entryId) =>
    call("reveal_entry_notes", parseSecretString, { entryId }),
  copyEntryUsername: (entryId) =>
    call("copy_entry_username", parseClipboardReceipt, { entryId }),
  copyEntryPassword: (entryId) =>
    call("copy_entry_password", parseClipboardReceipt, { entryId }),
  lockVault: () => call("lock_vault", parseLockResult),
};
