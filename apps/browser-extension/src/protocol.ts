export const PROTOCOL_VERSION = 1 as const;
export const MAX_CREDENTIAL_FIELD_LENGTH = 16_384;

interface FillTarget {
  usernameFieldHandle: string | null;
  passwordFieldHandle: string;
}

export interface PageStateChanged {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "pageStateChanged";
  documentNonce: string;
  hasLoginForm: boolean;
  passwordFieldCount: number;
  usernameCandidateCount: number;
  formCount: number;
  fillTarget: FillTarget | null;
}

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

export type RecordValue = Record<string, unknown>;

export function recordWithKeys(
  value: unknown,
  keys: readonly string[],
): value is RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

export function hasProtocol(value: RecordValue): boolean {
  return value["protocolVersion"] === PROTOCOL_VERSION;
}

export function isOpaqueToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isFillTarget(value: unknown): value is FillTarget | null {
  if (value === null) return true;
  return (
    recordWithKeys(value, ["usernameFieldHandle", "passwordFieldHandle"]) &&
    (value["usernameFieldHandle"] === null ||
      isOpaqueToken(value["usernameFieldHandle"])) &&
    isOpaqueToken(value["passwordFieldHandle"])
  );
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
    "fillTarget",
  ];
  if (
    !recordWithKeys(value, keys) ||
    !hasProtocol(value) ||
    value["type"] !== "pageStateChanged" ||
    !isOpaqueToken(value["documentNonce"]) ||
    typeof value["hasLoginForm"] !== "boolean" ||
    !isCount(value["passwordFieldCount"]) ||
    !isCount(value["usernameCandidateCount"]) ||
    !isCount(value["formCount"]) ||
    !isFillTarget(value["fillTarget"])
  ) {
    return null;
  }
  return value as unknown as PageStateChanged;
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
  if (!recordWithKeys(value, keys) || !hasProtocol(value)) return null;
  const usernameHandle = value["usernameFieldHandle"];
  if (
    value["type"] !== "applyCredential" ||
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

export function parseDocumentHello(value: unknown): DocumentHello | null {
  if (
    !recordWithKeys(value, ["protocolVersion", "type", "documentNonce"]) ||
    !hasProtocol(value) ||
    value["type"] !== "documentHello" ||
    !isOpaqueToken(value["documentNonce"])
  ) {
    return null;
  }
  return value as unknown as DocumentHello;
}
