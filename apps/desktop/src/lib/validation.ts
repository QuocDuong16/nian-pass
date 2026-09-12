import type { ClosePolicyDto, SelectedVaultDto } from "../types/desktop";
import {
  invalidContract,
  nonEmptyString,
  record,
} from "./validation-primitives";

export { parseDesktopErrorCode } from "./desktop-errors";
export {
  invalidContract,
  nonEmptyString,
  parseSummaryText,
  record,
  stringValue,
} from "./validation-primitives";
export {
  parseCleanVaultSnapshot,
  parseCreatedCoreEntry,
  parseCreatedCoreGroup,
  parseCreatedEntry,
  parseCreatedGroup,
  parseVaultCoreSnapshot,
  parseVaultSnapshot,
} from "./snapshot-validation";

export function parseSelectedVault(value: unknown): SelectedVaultDto {
  const object = record(value, ["fileName"]);
  return { fileName: nonEmptyString(object["fileName"]) };
}

export function parseClosePolicy(value: unknown): ClosePolicyDto {
  const object = record(value, ["policy"]);
  if (object["policy"] !== "allow" && object["policy"] !== "confirm_discard") {
    return invalidContract();
  }
  return { policy: object["policy"] };
}
