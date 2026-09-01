import {
  PROTOCOL_VERSION,
  hasProtocol,
  isOpaqueToken,
  recordWithKeys,
} from "./protocol";

export type PopupToBackground =
  | { protocolVersion: 1; type: "getSiteStatus" }
  | { protocolVersion: 1; type: "connectDesktop" }
  | { protocolVersion: 1; type: "listCandidates" }
  | { protocolVersion: 1; type: "fillCandidate"; candidateHandle: string };

export interface SiteStatus {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "siteStatus";
  site: { host: string; origin: string; permissionPattern: string } | null;
  permission: "enabled" | "disabled" | "unsupported";
  detection: "detected" | "notDetected" | "waiting" | "unavailable";
}

export type DesktopConnectionState =
  "disconnected" | "waiting" | "connected" | "locked" | "ready";

export type CandidateText =
  { kind: "visible"; value: string } | { kind: "protected" };

export interface PopupCandidate {
  candidateHandle: string;
  title: CandidateText;
  username: CandidateText;
}

export interface BrowserIntegrationStatus {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "browserIntegrationStatus";
  connection: DesktopConnectionState;
  candidates: PopupCandidate[];
  truncated: boolean;
  error:
    | null
    | "desktopUnavailable"
    | "denied"
    | "locked"
    | "noMatches"
    | "unsupportedTarget"
    | "internal";
}

export interface FillCandidateResult {
  protocolVersion: typeof PROTOCOL_VERSION;
  type: "fillCandidateResult";
  success: boolean;
}

function isCandidateText(value: unknown): value is CandidateText {
  return (
    (recordWithKeys(value, ["kind"]) && value["kind"] === "protected") ||
    (recordWithKeys(value, ["kind", "value"]) &&
      value["kind"] === "visible" &&
      typeof value["value"] === "string" &&
      new TextEncoder().encode(value["value"]).length <= 128)
  );
}

export function parsePopupMessage(value: unknown): PopupToBackground | null {
  if (
    recordWithKeys(value, ["protocolVersion", "type"]) &&
    hasProtocol(value)
  ) {
    if (
      value["type"] === "getSiteStatus" ||
      value["type"] === "connectDesktop" ||
      value["type"] === "listCandidates"
    ) {
      return value as unknown as PopupToBackground;
    }
  }
  if (
    recordWithKeys(value, ["protocolVersion", "type", "candidateHandle"]) &&
    hasProtocol(value) &&
    value["type"] === "fillCandidate" &&
    isOpaqueToken(value["candidateHandle"])
  ) {
    return value as unknown as PopupToBackground;
  }
  return null;
}

export function parseSiteStatus(value: unknown): SiteStatus | null {
  const keys = ["protocolVersion", "type", "site", "permission", "detection"];
  if (
    !recordWithKeys(value, keys) ||
    !hasProtocol(value) ||
    value["type"] !== "siteStatus"
  ) {
    return null;
  }
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

export function parseBrowserIntegrationStatus(
  value: unknown,
): BrowserIntegrationStatus | null {
  const keys = [
    "protocolVersion",
    "type",
    "connection",
    "candidates",
    "truncated",
    "error",
  ];
  if (
    !recordWithKeys(value, keys) ||
    !hasProtocol(value) ||
    value["type"] !== "browserIntegrationStatus"
  ) {
    return null;
  }
  const candidates = value["candidates"];
  const validCandidates =
    Array.isArray(candidates) &&
    candidates.length <= 100 &&
    candidates.every(
      (candidate) =>
        recordWithKeys(candidate, ["candidateHandle", "title", "username"]) &&
        isOpaqueToken(candidate["candidateHandle"]) &&
        isCandidateText(candidate["title"]) &&
        isCandidateText(candidate["username"]),
    );
  const validConnection =
    value["connection"] === "disconnected" ||
    value["connection"] === "waiting" ||
    value["connection"] === "connected" ||
    value["connection"] === "locked" ||
    value["connection"] === "ready";
  const validError =
    value["error"] === null ||
    value["error"] === "desktopUnavailable" ||
    value["error"] === "denied" ||
    value["error"] === "locked" ||
    value["error"] === "noMatches" ||
    value["error"] === "unsupportedTarget" ||
    value["error"] === "internal";
  return validCandidates &&
    validConnection &&
    validError &&
    typeof value["truncated"] === "boolean"
    ? (value as unknown as BrowserIntegrationStatus)
    : null;
}

export function parseFillCandidateResult(
  value: unknown,
): FillCandidateResult | null {
  return recordWithKeys(value, ["protocolVersion", "type", "success"]) &&
    hasProtocol(value) &&
    value["type"] === "fillCandidateResult" &&
    typeof value["success"] === "boolean"
    ? (value as unknown as FillCandidateResult)
    : null;
}
