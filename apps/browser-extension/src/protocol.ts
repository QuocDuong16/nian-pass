export const PROTOCOL_VERSION = 1 as const;

export interface PageStateChanged {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "pageStateChanged";
  documentNonce: string;
  hasLoginForm: boolean;
  passwordFieldCount: number;
  usernameCandidateCount: number;
  formCount: number;
}

interface GetSiteStatus {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "getSiteStatus";
}

interface EnableSite {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "enableSite";
}

interface DisableSite {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "disableSite";
}

export type PopupToBackground = GetSiteStatus | EnableSite | DisableSite;

export interface ApplyCredential {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "applyCredential";
  documentNonce: string;
  usernameFieldHandle: string | null;
  passwordFieldHandle: string;
  username: string;
  password: string;
}

export interface SiteStatus {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "siteStatus";
  site: { host: string; origin: string } | null;
  permission: "enabled" | "disabled" | "unsupported";
  detection: "detected" | "notDetected" | "waiting" | "unavailable";
}

export interface ActionResult {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "actionResult";
  ok: boolean;
}

type RecordValue = Record<string, unknown>;

function recordWithKeys(
  value: unknown,
  keys: readonly string[],
): value is RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function hasProtocol(value: RecordValue): boolean {
  return value["protocolVersion"] === PROTOCOL_VERSION;
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonce(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

export function parsePageStateChanged(value: unknown): PageStateChanged | null {
  const keys = [
    "protocolVersion",
    "type",
    "documentNonce",
    "hasLoginForm",
    "passwordFieldCount",
    "usernameCandidateCount",
    "formCount",
  ];
  if (
    !recordWithKeys(value, keys) ||
    !hasProtocol(value) ||
    value["type"] !== "pageStateChanged"
  ) {
    return null;
  }
  if (
    !isNonce(value["documentNonce"]) ||
    typeof value["hasLoginForm"] !== "boolean" ||
    !isCount(value["passwordFieldCount"]) ||
    !isCount(value["usernameCandidateCount"]) ||
    !isCount(value["formCount"])
  ) {
    return null;
  }
  return value as unknown as PageStateChanged;
}

export function parsePopupMessage(value: unknown): PopupToBackground | null {
  if (
    !recordWithKeys(value, ["protocolVersion", "type"]) ||
    !hasProtocol(value)
  )
    return null;
  if (
    value["type"] === "getSiteStatus" ||
    value["type"] === "enableSite" ||
    value["type"] === "disableSite"
  ) {
    return value as unknown as PopupToBackground;
  }
  return null;
}

export function parseApplyCredential(value: unknown): ApplyCredential | null {
  const keys = [
    "protocolVersion",
    "type",
    "documentNonce",
    "usernameFieldHandle",
    "passwordFieldHandle",
    "username",
    "password",
  ];
  if (
    !recordWithKeys(value, keys) ||
    !hasProtocol(value) ||
    value["type"] !== "applyCredential"
  ) {
    return null;
  }
  const usernameHandle = value["usernameFieldHandle"];
  if (
    !isNonce(value["documentNonce"]) ||
    !(usernameHandle === null || typeof usernameHandle === "string") ||
    typeof value["passwordFieldHandle"] !== "string" ||
    typeof value["username"] !== "string" ||
    typeof value["password"] !== "string"
  ) {
    return null;
  }
  return value as unknown as ApplyCredential;
}

export function parseSiteStatus(value: unknown): SiteStatus | null {
  const keys = ["protocolVersion", "type", "site", "permission", "detection"];
  if (
    !recordWithKeys(value, keys) ||
    !hasProtocol(value) ||
    value["type"] !== "siteStatus"
  )
    return null;
  const site = value["site"];
  const validSite =
    site === null ||
    (recordWithKeys(site, ["host", "origin"]) &&
      typeof site["host"] === "string" &&
      typeof site["origin"] === "string");
  const validPermission =
    value["permission"] === "enabled" ||
    value["permission"] === "disabled" ||
    value["permission"] === "unsupported";
  const validDetection =
    value["detection"] === "detected" ||
    value["detection"] === "notDetected" ||
    value["detection"] === "waiting" ||
    value["detection"] === "unavailable";
  return validSite && validPermission && validDetection
    ? (value as unknown as SiteStatus)
    : null;
}

export function parseActionResult(value: unknown): ActionResult | null {
  if (
    !recordWithKeys(value, ["protocolVersion", "type", "ok"]) ||
    !hasProtocol(value) ||
    value["type"] !== "actionResult" ||
    typeof value["ok"] !== "boolean"
  )
    return null;
  return value as unknown as ActionResult;
}
