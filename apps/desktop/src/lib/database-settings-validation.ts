import type {
  DatabaseMetadataDto,
  DatabaseMetadataUpdateReceiptDto,
  HistoryPolicyDto,
  HistoryPolicyUpdateReceiptDto,
} from "../types/desktop";
import {
  invalidContract,
  nullableSafeInteger,
  record,
  stringValue,
} from "./validation-primitives";
import { parseVaultSnapshot } from "./validation";

export function parseDatabaseMetadata(value: unknown): DatabaseMetadataDto {
  const object = record(value, ["name", "description", "defaultUsername"]);
  return {
    name: stringValue(object["name"]),
    description: stringValue(object["description"]),
    defaultUsername: stringValue(object["defaultUsername"]),
  };
}

export function parseDatabaseMetadataUpdateReceipt(
  value: unknown,
): DatabaseMetadataUpdateReceiptDto {
  const object = record(value, ["metadata", "snapshot"]);
  return {
    metadata: parseDatabaseMetadata(object["metadata"]),
    snapshot: parseVaultSnapshot(object["snapshot"]),
  };
}

export function parseHistoryPolicy(value: unknown): HistoryPolicyDto {
  const object = record(value, ["maxItems", "maximumEditableItems"]);
  const maxItems = nullableSafeInteger(object["maxItems"]);
  const maximumEditableItems = nullableSafeInteger(
    object["maximumEditableItems"],
  );
  if (
    (maxItems !== null && maxItems < 0) ||
    maximumEditableItems === null ||
    maximumEditableItems < 0
  ) {
    return invalidContract();
  }
  return { maxItems, maximumEditableItems };
}

export function parseHistoryPolicyUpdateReceipt(
  value: unknown,
): HistoryPolicyUpdateReceiptDto {
  const object = record(value, ["policy", "snapshot"]);
  return {
    policy: parseHistoryPolicy(object["policy"]),
    snapshot: parseVaultSnapshot(object["snapshot"]),
  };
}
