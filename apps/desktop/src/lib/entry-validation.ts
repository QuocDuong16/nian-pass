import type {
  AttachmentExportReceiptDto,
  ClipboardReceiptDto,
  CustomFieldSummaryDto,
  EntryAttachmentSummaryDto,
  EntryDetailDto,
  EntryHistoryDto,
  EntryHistoryItemDto,
  LockResultDto,
  TotpCodeDto,
} from "../types/desktop";
import { parseEntryIcon } from "./entry-icon-validation";
import {
  invalidContract,
  nonEmptyString,
  nullableSafeInteger,
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
    "totpPresent",
    "tags",
    "expiresAtUnixSeconds",
    "icon",
    "customFields",
  ]);
  if (
    typeof object["passwordPresent"] !== "boolean" ||
    typeof object["notesPresent"] !== "boolean" ||
    typeof object["totpPresent"] !== "boolean" ||
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
    totpPresent: object["totpPresent"],
    tags: object["tags"].map(nonEmptyString),
    expiresAtUnixSeconds: nullableSafeInteger(object["expiresAtUnixSeconds"]),
    icon: parseEntryIcon(object["icon"]),
    customFields: object["customFields"].map(parseCustomField),
  };
}

function parseEntryHistoryItem(value: unknown): EntryHistoryItemDto {
  const object = record(value, [
    "index",
    "modifiedAtUnixSeconds",
    "title",
    "username",
    "url",
    "passwordPresent",
    "notesPresent",
    "totpPresent",
    "tags",
    "expiresAtUnixSeconds",
    "restorable",
  ]);
  const index = object["index"];
  if (
    typeof index !== "number" ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    typeof object["passwordPresent"] !== "boolean" ||
    typeof object["notesPresent"] !== "boolean" ||
    typeof object["totpPresent"] !== "boolean" ||
    typeof object["restorable"] !== "boolean" ||
    !Array.isArray(object["tags"])
  ) {
    return invalidContract();
  }
  return {
    index,
    modifiedAtUnixSeconds: nullableSafeInteger(object["modifiedAtUnixSeconds"]),
    title: parseSummaryText(object["title"]),
    username: parseSummaryText(object["username"]),
    url: parseSummaryText(object["url"]),
    passwordPresent: object["passwordPresent"],
    notesPresent: object["notesPresent"],
    totpPresent: object["totpPresent"],
    tags: object["tags"].map(nonEmptyString),
    expiresAtUnixSeconds: nullableSafeInteger(object["expiresAtUnixSeconds"]),
    restorable: object["restorable"],
  };
}

export function parseEntryHistory(value: unknown): EntryHistoryDto {
  const object = record(value, ["documentRevision", "items"]);
  const documentRevision = stringValue(object["documentRevision"]);
  if (!/^\d+$/.test(documentRevision) || !Array.isArray(object["items"])) {
    return invalidContract();
  }
  return {
    documentRevision,
    items: object["items"].map(parseEntryHistoryItem),
  };
}

export function parseTotpCode(value: unknown): TotpCodeDto {
  const object = record(value, ["code", "validForSeconds", "periodSeconds"]);
  const code = stringValue(object["code"]);
  const validForSeconds = object["validForSeconds"];
  const periodSeconds = object["periodSeconds"];
  if (
    !/^\d{6,10}$/.test(code) ||
    typeof validForSeconds !== "number" ||
    !Number.isSafeInteger(validForSeconds) ||
    validForSeconds <= 0 ||
    typeof periodSeconds !== "number" ||
    !Number.isSafeInteger(periodSeconds) ||
    periodSeconds <= 0 ||
    validForSeconds > periodSeconds
  ) {
    return invalidContract();
  }
  return { code, validForSeconds, periodSeconds };
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

export function parseEntryAttachments(
  value: unknown,
): EntryAttachmentSummaryDto[] {
  if (!Array.isArray(value)) return invalidContract();
  return value.map((item) => {
    const object = record(item, ["name", "sizeBytes", "protected"]);
    const sizeBytes = object["sizeBytes"];
    if (
      typeof sizeBytes !== "number" ||
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes < 0 ||
      typeof object["protected"] !== "boolean"
    ) {
      return invalidContract();
    }
    return {
      name: stringValue(object["name"]),
      sizeBytes,
      protected: object["protected"],
    };
  });
}

export function parseAttachmentExportReceipt(
  value: unknown,
): AttachmentExportReceiptDto {
  const object = record(value, ["exported"]);
  if (object["exported"] !== true) return invalidContract();
  return { exported: true };
}
