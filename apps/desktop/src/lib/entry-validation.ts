import type {
  ClipboardReceiptDto,
  CustomFieldSummaryDto,
  EntryDetailDto,
  LockResultDto,
} from "../types/desktop";
import {
  invalidContract,
  nonEmptyString,
  parseSummaryText,
  record,
  stringValue,
} from "./validation";

function parseCustomField(value: unknown): CustomFieldSummaryDto {
  const object = record(value, ["name", "protection"]);
  const protection = object["protection"];
  if (protection !== "protected" && protection !== "unprotected") {
    return invalidContract();
  }
  return { name: nonEmptyString(object["name"]), protection };
}

export function parseEntryDetail(value: unknown): EntryDetailDto {
  const object = record(value, [
    "id",
    "title",
    "username",
    "url",
    "passwordPresent",
    "notesPresent",
    "tags",
    "customFields",
  ]);
  if (
    typeof object["passwordPresent"] !== "boolean" ||
    typeof object["notesPresent"] !== "boolean" ||
    !Array.isArray(object["tags"]) ||
    !Array.isArray(object["customFields"])
  ) {
    return invalidContract();
  }
  return {
    id: nonEmptyString(object["id"]),
    title: parseSummaryText(object["title"]),
    username: parseSummaryText(object["username"]),
    url: parseSummaryText(object["url"]),
    passwordPresent: object["passwordPresent"],
    notesPresent: object["notesPresent"],
    tags: object["tags"].map(nonEmptyString),
    customFields: object["customFields"].map(parseCustomField),
  };
}

export function parseSecretString(value: unknown): string {
  return stringValue(value);
}

export function parseClipboardReceipt(value: unknown): ClipboardReceiptDto {
  const object = record(value, ["copied", "expiresInMs"]);
  if (
    object["copied"] !== true ||
    typeof object["expiresInMs"] !== "number" ||
    !Number.isSafeInteger(object["expiresInMs"]) ||
    object["expiresInMs"] <= 0
  ) {
    return invalidContract();
  }
  return { copied: true, expiresInMs: object["expiresInMs"] };
}

export function parseLockResult(value: unknown): LockResultDto {
  const object = record(value, ["clipboard"]);
  const clipboard = object["clipboard"];
  if (
    clipboard !== "cleared" &&
    clipboard !== "not_owned" &&
    clipboard !== "clear_failed"
  ) {
    return invalidContract();
  }
  return { clipboard };
}
