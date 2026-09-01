import {
  MAX_CREDENTIAL_FIELD_LENGTH,
  isOpaqueToken,
  recordWithKeys,
} from "./protocol";
import type { CandidateText } from "./popup-protocol";

export type NativeRequest =
  | { version: 1; type: "connect"; requestId: string }
  | { version: 1; type: "candidates"; requestId: string; origin: string }
  | {
      version: 1;
      type: "credential";
      requestId: string;
      origin: string;
      vaultSessionId: string;
      entryId: string;
    };

export interface NativeCandidate {
  entryId: string;
  title: CandidateText;
  username: CandidateText;
}

export type NativeErrorCode =
  | "desktopUnavailable"
  | "approvalRequired"
  | "denied"
  | "locked"
  | "noMatches"
  | "unsupportedTarget"
  | "invalidRequest"
  | "internal";

export type NativeResponse =
  | { version: 1; type: "approvalPending"; requestId: string }
  | {
      version: 1;
      type: "connected";
      requestId: string;
      vaultState: "locked" | "ready";
    }
  | {
      version: 1;
      type: "candidates";
      requestId: string;
      vaultSessionId: string;
      candidates: NativeCandidate[];
      truncated: boolean;
    }
  | {
      version: 1;
      type: "credential";
      requestId: string;
      username: string;
      password: string;
    }
  | { version: 1; type: "error"; requestId: string; code: NativeErrorCode };

const nativeErrors = new Set<NativeErrorCode>([
  "desktopUnavailable",
  "approvalRequired",
  "denied",
  "locked",
  "noMatches",
  "unsupportedTarget",
  "invalidRequest",
  "internal",
]);

function isCandidateText(value: unknown): value is CandidateText {
  return (
    (recordWithKeys(value, ["kind"]) && value["kind"] === "protected") ||
    (recordWithKeys(value, ["kind", "value"]) &&
      value["kind"] === "visible" &&
      typeof value["value"] === "string" &&
      new TextEncoder().encode(value["value"]).length <= 128)
  );
}

function isNativeCandidate(value: unknown): value is NativeCandidate {
  return (
    recordWithKeys(value, ["entryId", "title", "username"]) &&
    typeof value["entryId"] === "string" &&
    value["entryId"].length > 0 &&
    value["entryId"].length <= 256 &&
    isCandidateText(value["title"]) &&
    isCandidateText(value["username"])
  );
}

function validOrigin(value: object): boolean {
  const origin = (value as Record<string, unknown>)["origin"];
  return typeof origin === "string" && origin.length <= 2_048;
}

function validEntryId(value: unknown): boolean {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

export function parseNativeRequest(value: unknown): NativeRequest | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record["version"] !== 1 || !isOpaqueToken(record["requestId"])) {
    return null;
  }
  const type = record["type"];
  if (
    type === "connect" &&
    recordWithKeys(value, ["version", "type", "requestId"])
  ) {
    return value as NativeRequest;
  }
  if (
    type === "candidates" &&
    recordWithKeys(value, ["version", "type", "requestId", "origin"]) &&
    validOrigin(value)
  ) {
    return value as NativeRequest;
  }
  if (
    type === "credential" &&
    recordWithKeys(value, [
      "version",
      "type",
      "requestId",
      "origin",
      "vaultSessionId",
      "entryId",
    ]) &&
    validOrigin(value) &&
    isOpaqueToken(record["vaultSessionId"]) &&
    validEntryId(record["entryId"])
  ) {
    return value as NativeRequest;
  }
  return null;
}

export function parseNativeResponse(value: unknown): NativeResponse | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (record["version"] !== 1 || !isOpaqueToken(record["requestId"])) {
    return null;
  }
  const type = record["type"];
  if (
    type === "approvalPending" &&
    recordWithKeys(value, ["version", "type", "requestId"])
  ) {
    return value as NativeResponse;
  }
  if (
    type === "connected" &&
    recordWithKeys(value, ["version", "type", "requestId", "vaultState"]) &&
    (record["vaultState"] === "locked" || record["vaultState"] === "ready")
  ) {
    return value as NativeResponse;
  }
  if (type === "candidates" && validCandidatesResponse(value)) {
    return value as NativeResponse;
  }
  if (type === "credential" && validCredentialResponse(value)) {
    return value as NativeResponse;
  }
  if (
    type === "error" &&
    recordWithKeys(value, ["version", "type", "requestId", "code"]) &&
    nativeErrors.has(record["code"] as NativeErrorCode)
  ) {
    return value as NativeResponse;
  }
  return null;
}

function validCandidatesResponse(value: object): boolean {
  const keys = [
    "version",
    "type",
    "requestId",
    "vaultSessionId",
    "candidates",
    "truncated",
  ];
  if (!recordWithKeys(value, keys)) return false;
  const record = value as Record<string, unknown>;
  const candidates = record["candidates"];
  return (
    isOpaqueToken(record["vaultSessionId"]) &&
    Array.isArray(candidates) &&
    candidates.length <= 100 &&
    candidates.every(isNativeCandidate) &&
    typeof record["truncated"] === "boolean"
  );
}

function validCredentialResponse(value: object): boolean {
  const keys = ["version", "type", "requestId", "username", "password"];
  if (!recordWithKeys(value, keys)) return false;
  const record = value as Record<string, unknown>;
  const username = record["username"];
  const password = record["password"];
  return (
    typeof username === "string" &&
    username.length <= MAX_CREDENTIAL_FIELD_LENGTH &&
    typeof password === "string" &&
    password.length <= MAX_CREDENTIAL_FIELD_LENGTH
  );
}
