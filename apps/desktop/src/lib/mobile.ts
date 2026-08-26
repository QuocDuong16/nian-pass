import { invoke } from "@tauri-apps/api/core";

import type { MobileApi, MobileErrorCode } from "../types/mobile";
import { parseEntryDetail } from "./entry-validation";
import { parseSelectedVault, parseVaultSnapshot } from "./validation";

const mobileErrorCodes = new Set<MobileErrorCode>([
  "picker_failed",
  "no_vault_selected",
  "unlock_failed",
  "unsupported_vault",
  "entry_not_found",
  "locked",
  "internal",
]);

export class MobileCommandError extends Error {
  readonly code: MobileErrorCode;

  constructor(code: MobileErrorCode) {
    super("Nian Pass mobile command failed");
    this.name = "MobileCommandError";
    this.code = code;
  }
}

export function parseMobileErrorCode(value: unknown): MobileErrorCode {
  if (
    typeof value === "string" &&
    mobileErrorCodes.has(value as MobileErrorCode)
  ) {
    return value as MobileErrorCode;
  }
  throw new Error("invalid mobile error code");
}

function toMobileError(error: unknown): MobileCommandError {
  if (error instanceof MobileCommandError) return error;
  if (typeof error === "object" && error !== null && "code" in error) {
    try {
      return new MobileCommandError(
        parseMobileErrorCode(Reflect.get(error, "code")),
      );
    } catch {
      return new MobileCommandError("internal");
    }
  }
  return new MobileCommandError("internal");
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
    throw toMobileError(error);
  }
  try {
    return parse(value);
  } catch {
    throw new MobileCommandError("internal");
  }
}

function parseVoid(value: unknown): void {
  if (value !== null) throw new Error("invalid mobile void response");
}

export const mobileApi: MobileApi = {
  selectVault: () =>
    call("mobile_select_vault", (value) =>
      value === null ? null : parseSelectedVault(value),
    ),
  unlockVault: (password) =>
    call("mobile_unlock_vault", parseVaultSnapshot, { password }),
  getVaultSnapshot: () => call("mobile_vault_snapshot", parseVaultSnapshot),
  getEntryDetail: (entryId) =>
    call("mobile_entry_detail", parseEntryDetail, { entryId }),
  lockVault: () => call("mobile_lock_vault", parseVoid),
};
