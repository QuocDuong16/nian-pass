import type {
  CreatedEntryBaseDto,
  CreatedEntryDto,
  CreatedGroupBaseDto,
  CreatedGroupDto,
  EntrySummaryDto,
  GroupDto,
  VaultCapabilitiesDto,
  VaultCoreSnapshotDto,
  VaultSnapshotDto,
  WriteRestriction,
} from "../types/desktop";
import { parseEntryIcon } from "./entry-icon-validation";
import { validateSnapshotRelations } from "./snapshot-relations";
import {
  invalidContract,
  nonEmptyString,
  nullableSafeInteger,
  parseSummaryText,
  record,
  stringValue,
} from "./validation-primitives";

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return invalidContract();
  return value.map(nonEmptyString);
}

function parseGroup(value: unknown): GroupDto {
  const object = record(value, ["id", "name", "childGroupIds", "entryIds"]);
  return {
    id: nonEmptyString(object["id"]),
    name: stringValue(object["name"]),
    childGroupIds: strings(object["childGroupIds"]),
    entryIds: strings(object["entryIds"]),
  };
}

function parseEntry(value: unknown): EntrySummaryDto {
  const object = record(value, [
    "id",
    "groupId",
    "title",
    "username",
    "url",
    "passwordPresent",
    "notesPresent",
    "totpPresent",
    "tags",
    "expiresAtUnixSeconds",
    "icon",
  ]);
  if (
    typeof object["passwordPresent"] !== "boolean" ||
    typeof object["notesPresent"] !== "boolean" ||
    typeof object["totpPresent"] !== "boolean"
  ) {
    return invalidContract();
  }
  return {
    id: nonEmptyString(object["id"]),
    groupId: nonEmptyString(object["groupId"]),
    title: parseSummaryText(object["title"]),
    username: parseSummaryText(object["username"]),
    url: parseSummaryText(object["url"]),
    passwordPresent: object["passwordPresent"],
    notesPresent: object["notesPresent"],
    totpPresent: object["totpPresent"],
    tags: strings(object["tags"]),
    expiresAtUnixSeconds: nullableSafeInteger(object["expiresAtUnixSeconds"]),
    icon: parseEntryIcon(object["icon"]),
  };
}

function parseVaultCapabilities(value: unknown): VaultCapabilitiesDto {
  const object = record(value, [
    "formatVersion",
    "writable",
    "writeRestriction",
  ]);
  if (typeof object["writable"] !== "boolean") return invalidContract();
  const rawRestriction = object["writeRestriction"];
  const allowed: readonly WriteRestriction[] = [
    "unsupported_write_format",
    "unsupported_persistence_platform",
    "read_only_source",
  ];
  const writeRestriction =
    rawRestriction === null
      ? null
      : (allowed.find((restriction) => restriction === rawRestriction) ??
        invalidContract());
  if (object["writable"] !== (writeRestriction === null)) {
    return invalidContract();
  }
  return {
    formatVersion: nonEmptyString(object["formatVersion"]),
    writable: object["writable"],
    writeRestriction,
  };
}

function parseVaultCoreRecord(
  object: Record<string, unknown>,
): VaultCoreSnapshotDto {
  if (
    typeof object["dirty"] !== "boolean" ||
    typeof object["recycleBinEnabled"] !== "boolean" ||
    !Array.isArray(object["groups"]) ||
    !Array.isArray(object["entries"])
  ) {
    return invalidContract();
  }
  const rawRecycleBinGroupId = object["recycleBinGroupId"];
  const snapshot: VaultCoreSnapshotDto = {
    dirty: object["dirty"],
    recycleBinEnabled: object["recycleBinEnabled"],
    recycleBinGroupId:
      rawRecycleBinGroupId === null
        ? null
        : nonEmptyString(rawRecycleBinGroupId),
    rootGroupId: nonEmptyString(object["rootGroupId"]),
    groups: object["groups"].map(parseGroup),
    entries: object["entries"].map(parseEntry),
  };
  validateSnapshotRelations(snapshot);
  return snapshot;
}

export function parseVaultCoreSnapshot(value: unknown): VaultCoreSnapshotDto {
  return parseVaultCoreRecord(
    record(value, [
      "dirty",
      "recycleBinEnabled",
      "recycleBinGroupId",
      "rootGroupId",
      "groups",
      "entries",
    ]),
  );
}

export function parseVaultSnapshot(value: unknown): VaultSnapshotDto {
  const object = record(value, [
    "dirty",
    "fileName",
    "capabilities",
    "recycleBinEnabled",
    "recycleBinGroupId",
    "rootGroupId",
    "groups",
    "entries",
  ]);
  return {
    ...parseVaultCoreRecord(object),
    fileName: nonEmptyString(object["fileName"]),
    capabilities: parseVaultCapabilities(object["capabilities"]),
  };
}

export function parseCleanVaultSnapshot(value: unknown): VaultSnapshotDto {
  const snapshot = parseVaultSnapshot(value);
  if (snapshot.dirty) return invalidContract();
  return snapshot;
}

export function parseCreatedCoreEntry(value: unknown): CreatedEntryBaseDto {
  const object = record(value, ["createdEntryId", "snapshot"]);
  const createdEntryId = nonEmptyString(object["createdEntryId"]);
  const snapshot = parseVaultCoreSnapshot(object["snapshot"]);
  if (!snapshot.entries.some((entry) => entry.id === createdEntryId)) {
    return invalidContract();
  }
  return { createdEntryId, snapshot };
}

export function parseCreatedCoreGroup(value: unknown): CreatedGroupBaseDto {
  const object = record(value, ["createdGroupId", "snapshot"]);
  const createdGroupId = nonEmptyString(object["createdGroupId"]);
  const snapshot = parseVaultCoreSnapshot(object["snapshot"]);
  if (!snapshot.groups.some((group) => group.id === createdGroupId)) {
    return invalidContract();
  }
  return { createdGroupId, snapshot };
}

export function parseCreatedEntry(value: unknown): CreatedEntryDto {
  const object = record(value, ["createdEntryId", "snapshot"]);
  const createdEntryId = nonEmptyString(object["createdEntryId"]);
  const snapshot = parseVaultSnapshot(object["snapshot"]);
  if (!snapshot.entries.some((entry) => entry.id === createdEntryId)) {
    return invalidContract();
  }
  return { createdEntryId, snapshot };
}

export function parseCreatedGroup(value: unknown): CreatedGroupDto {
  const object = record(value, ["createdGroupId", "snapshot"]);
  const createdGroupId = nonEmptyString(object["createdGroupId"]);
  const snapshot = parseVaultSnapshot(object["snapshot"]);
  if (!snapshot.groups.some((group) => group.id === createdGroupId)) {
    return invalidContract();
  }
  return { createdGroupId, snapshot };
}
