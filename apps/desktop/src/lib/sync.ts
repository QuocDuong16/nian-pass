import type { VaultSnapshotDto } from "../types/desktop";
import {
  invalidContract,
  nonEmptyString,
  parseVaultSnapshot,
  record,
} from "./validation";

export type SyncProfileTarget =
  | { provider: "webdav"; resourceUrl: string }
  | { provider: "gateway"; baseUrl: string; vaultId: string }
  | {
      provider: "s3";
      endpoint: string | null;
      region: string;
      bucket: string;
      objectKey: string;
      pathStyle: boolean;
    };

export interface SyncProfileDto {
  profileId: string;
  target: SyncProfileTarget;
  available: boolean;
  recoveryStatus: "none" | "required" | "unsupported";
}

export interface SaveSyncProfileRequest {
  profileId?: string;
  target: SyncProfileTarget;
}

export interface ProviderCredentials {
  webdav?: { username: string; password: string };
  gateway?: { accessToken: string };
  s3?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
}

interface SyncConflictDescriptor {
  objectKind: string;
  objectId: string | null;
  conflictKind: string;
  fieldKind: string | null;
}

export interface SyncConflictOperation {
  conflictOperationId: string;
  initialConflict: boolean;
  conflicts: SyncConflictDescriptor[];
}

export interface SyncResultDto {
  status: "done" | "waitingForConflictDecision";
  conflict: SyncConflictOperation | null;
  snapshot: VaultSnapshotDto;
}

export interface TestProviderResultDto {
  status: "missing" | "present";
}

export function parseSyncProfiles(value: unknown): SyncProfileDto[] {
  if (!Array.isArray(value)) return invalidContract();
  return value.map(parseSyncProfile);
}

export function parseSyncProfile(value: unknown): SyncProfileDto {
  const object = record(value, [
    "profileId",
    "target",
    "available",
    "recoveryStatus",
  ]);
  if (
    typeof object["available"] !== "boolean" ||
    (object["recoveryStatus"] !== "none" &&
      object["recoveryStatus"] !== "required" &&
      object["recoveryStatus"] !== "unsupported")
  ) {
    return invalidContract();
  }
  return {
    profileId: nonEmptyString(object["profileId"]),
    target: parseTarget(object["target"]),
    available: object["available"],
    recoveryStatus: object["recoveryStatus"],
  };
}

export function parseSyncResult(value: unknown): SyncResultDto {
  const object = record(value, ["status", "conflict", "snapshot"]);
  const status = object["status"];
  if (status !== "done" && status !== "waitingForConflictDecision") {
    return invalidContract();
  }
  const conflict =
    object["conflict"] === null
      ? null
      : parseConflictOperation(object["conflict"]);
  if (
    (status === "done" && conflict !== null) ||
    (status === "waitingForConflictDecision" && conflict === null)
  ) {
    return invalidContract();
  }
  return {
    status,
    conflict,
    snapshot: parseVaultSnapshot(object["snapshot"]),
  };
}

export function parseTestProviderResult(value: unknown): TestProviderResultDto {
  const object = record(value, ["status"]);
  const status = object["status"];
  if (status !== "missing" && status !== "present") {
    return invalidContract();
  }
  return { status };
}

function parseTarget(value: unknown): SyncProfileTarget {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidContract();
  }
  const provider = (value as Record<string, unknown>)["provider"];
  if (provider === "webdav") {
    const object = record(value, ["provider", "resourceUrl"]);
    return { provider, resourceUrl: nonEmptyString(object["resourceUrl"]) };
  }
  if (provider === "s3") {
    const object = record(value, [
      "provider",
      "endpoint",
      "region",
      "bucket",
      "objectKey",
      "pathStyle",
    ]);
    if (typeof object["pathStyle"] !== "boolean") return invalidContract();
    const endpoint = object["endpoint"];
    if (endpoint !== null && typeof endpoint !== "string") {
      return invalidContract();
    }
    return {
      provider,
      endpoint,
      region: nonEmptyString(object["region"]),
      bucket: nonEmptyString(object["bucket"]),
      objectKey: nonEmptyString(object["objectKey"]),
      pathStyle: object["pathStyle"],
    };
  }
  if (provider === "gateway") {
    const object = record(value, ["provider", "baseUrl", "vaultId"]);
    return {
      provider,
      baseUrl: nonEmptyString(object["baseUrl"]),
      vaultId: nonEmptyString(object["vaultId"]),
    };
  }
  return invalidContract();
}

function parseConflictOperation(value: unknown): SyncConflictOperation {
  const object = record(value, [
    "conflictOperationId",
    "initialConflict",
    "conflicts",
  ]);
  if (
    typeof object["initialConflict"] !== "boolean" ||
    !Array.isArray(object["conflicts"])
  ) {
    return invalidContract();
  }
  return {
    conflictOperationId: nonEmptyString(object["conflictOperationId"]),
    initialConflict: object["initialConflict"],
    conflicts: object["conflicts"].map((descriptor) => {
      const item = record(descriptor, [
        "objectKind",
        "objectId",
        "conflictKind",
        "fieldKind",
      ]);
      const objectId = item["objectId"];
      const fieldKind = item["fieldKind"];
      if (
        (objectId !== null && typeof objectId !== "string") ||
        (fieldKind !== null && typeof fieldKind !== "string")
      ) {
        return invalidContract();
      }
      return {
        objectKind: nonEmptyString(item["objectKind"]),
        objectId,
        conflictKind: nonEmptyString(item["conflictKind"]),
        fieldKind,
      };
    }),
  };
}
