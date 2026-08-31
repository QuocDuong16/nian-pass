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

export type PopupToBackground = GetSiteStatus;

export interface DocumentHello {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "documentHello";
  documentNonce: string;
}

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
  site: { host: string; origin: string; permissionPattern: string } | null;
  permission: "enabled" | "disabled" | "unsupported";
  detection: "detected" | "notDetected" | "waiting" | "unavailable";
}

const MAX_CREDENTIAL_FIELD_LENGTH = 65_536;

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

function isOpaqueToken(value: unknown): value is string {
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
    !isOpaqueToken(value["documentNonce"]) ||
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
  if (value["type"] === "getSiteStatus") {
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
    !isOpaqueToken(value["documentNonce"]) ||
    !(usernameHandle === null || isOpaqueToken(usernameHandle)) ||
    !isOpaqueToken(value["passwordFieldHandle"]) ||
    typeof value["username"] !== "string" ||
    value["username"].length > MAX_CREDENTIAL_FIELD_LENGTH ||
    typeof value["password"] !== "string" ||
    value["password"].length > MAX_CREDENTIAL_FIELD_LENGTH
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
    (recordWithKeys(site, ["host", "origin", "permissionPattern"]) &&
      typeof site["host"] === "string" &&
      typeof site["origin"] === "string" &&
      typeof site["permissionPattern"] === "string" &&
      /^(?:http|https):\/\/(?:\[[0-9a-fA-F:]+\]|[^/*]+)\/\*$/.test(
        site["permissionPattern"],
      ));
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

export function parseDocumentHello(value: unknown): DocumentHello | null {
  if (
    !recordWithKeys(value, ["protocolVersion", "type", "documentNonce"]) ||
    !hasProtocol(value) ||
    value["type"] !== "documentHello" ||
    !isOpaqueToken(value["documentNonce"])
  )
    return null;
  return value as unknown as DocumentHello;
}
