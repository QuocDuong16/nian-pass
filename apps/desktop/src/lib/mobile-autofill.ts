import type {
  AutofillCandidateDto,
  MobileAutofillLaunchDto,
  MobileAutofillStatusDto,
} from "../types/mobile";
import {
  invalidContract,
  nonEmptyString,
  parseSummaryText,
  record,
} from "./validation";

export function parseAutofillStatus(value: unknown): MobileAutofillStatusDto {
  const object = record(value, [
    "supported",
    "sourceEnabled",
    "providerSelected",
  ]);
  if (
    typeof object["supported"] !== "boolean" ||
    typeof object["sourceEnabled"] !== "boolean" ||
    typeof object["providerSelected"] !== "boolean"
  )
    return invalidContract();
  return {
    supported: object["supported"],
    sourceEnabled: object["sourceEnabled"],
    providerSelected: object["providerSelected"],
  };
}

function parseRequest(value: unknown): MobileAutofillLaunchDto["request"] {
  const object = record(value, [
    "requestToken",
    "kind",
    "targetDisplay",
    "requiresConfirmation",
    "selectedEntryId",
  ]);
  const kind = object["kind"];
  if (
    (kind !== "credential_query" &&
      kind !== "credential_fulfillment" &&
      kind !== "autofill") ||
    typeof object["requiresConfirmation"] !== "boolean" ||
    (object["selectedEntryId"] !== null &&
      typeof object["selectedEntryId"] !== "string")
  )
    return invalidContract();
  return {
    requestToken: nonEmptyString(object["requestToken"]),
    kind,
    targetDisplay: nonEmptyString(object["targetDisplay"]),
    requiresConfirmation: object["requiresConfirmation"],
    selectedEntryId:
      object["selectedEntryId"] === null
        ? null
        : nonEmptyString(object["selectedEntryId"]),
  };
}

function parseSelection(value: unknown) {
  const object = record(value, ["fileName", "writable"]);
  if (typeof object["writable"] !== "boolean") return invalidContract();
  return {
    fileName: nonEmptyString(object["fileName"]),
    writable: object["writable"],
  };
}

export function parseAutofillLaunch(value: unknown): MobileAutofillLaunchDto {
  const object = record(value, ["request", "selectedVault"]);
  return {
    request: parseRequest(object["request"]),
    selectedVault:
      object["selectedVault"] === null
        ? null
        : parseSelection(object["selectedVault"]),
  };
}

function parseCandidate(value: unknown): AutofillCandidateDto {
  const object = record(value, ["entryId", "title", "username"]);
  return {
    entryId: nonEmptyString(object["entryId"]),
    title: parseSummaryText(object["title"]),
    username: parseSummaryText(object["username"]),
  };
}

export function parseAutofillCandidates(
  value: unknown,
): AutofillCandidateDto[] {
  if (!Array.isArray(value)) return invalidContract();
  return value.map(parseCandidate);
}
