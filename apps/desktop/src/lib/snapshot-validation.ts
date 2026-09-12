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
import {
  invalidContract,
  nonEmptyString,
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
    "tags",
  ]);
  if (
    typeof object["passwordPresent"] !== "boolean" ||
    typeof object["notesPresent"] !== "boolean"
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
    tags: strings(object["tags"]),
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

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function validateRelations(snapshot: VaultCoreSnapshotDto): void {
  const groups = new Map(snapshot.groups.map((group) => [group.id, group]));
  const entries = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
  if (
    groups.size !== snapshot.groups.length ||
    entries.size !== snapshot.entries.length ||
    !groups.has(snapshot.rootGroupId)
  ) {
    return invalidContract();
  }

  const childParents = new Map<string, string>();
  const entryParents = new Map<string, string>();
  for (const group of snapshot.groups) {
    if (!unique(group.childGroupIds) || !unique(group.entryIds)) {
      return invalidContract();
    }
    for (const childId of group.childGroupIds) {
      if (
        !groups.has(childId) ||
        childId === snapshot.rootGroupId ||
        childParents.has(childId)
      ) {
        return invalidContract();
      }
      childParents.set(childId, group.id);
    }
    for (const entryId of group.entryIds) {
      const entry = entries.get(entryId);
      if (entry?.groupId !== group.id || entryParents.has(entryId)) {
        return invalidContract();
      }
      entryParents.set(entryId, group.id);
    }
  }
  if (entryParents.size !== entries.size) return invalidContract();

  const visited = new Set<string>();
  const visit = (groupId: string): void => {
    if (visited.has(groupId)) return invalidContract();
    visited.add(groupId);
    const group = groups.get(groupId);
    if (group === undefined) return invalidContract();
    group.childGroupIds.forEach(visit);
  };
  visit(snapshot.rootGroupId);
  if (visited.size !== groups.size) return invalidContract();
}

function parseVaultCoreRecord(
  object: Record<string, unknown>,
): VaultCoreSnapshotDto {
  if (
    typeof object["dirty"] !== "boolean" ||
    !Array.isArray(object["groups"]) ||
    !Array.isArray(object["entries"])
  ) {
    return invalidContract();
  }
  const snapshot: VaultCoreSnapshotDto = {
    dirty: object["dirty"],
    rootGroupId: nonEmptyString(object["rootGroupId"]),
    groups: object["groups"].map(parseGroup),
    entries: object["entries"].map(parseEntry),
  };
  validateRelations(snapshot);
  return snapshot;
}

export function parseVaultCoreSnapshot(value: unknown): VaultCoreSnapshotDto {
  return parseVaultCoreRecord(
    record(value, ["dirty", "rootGroupId", "groups", "entries"]),
  );
}

export function parseVaultSnapshot(value: unknown): VaultSnapshotDto {
  const object = record(value, [
    "dirty",
    "fileName",
    "capabilities",
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
