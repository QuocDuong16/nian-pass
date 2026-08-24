import type {
  DesktopErrorCode,
  EntrySummaryDto,
  GroupDto,
  SelectedVaultDto,
  SummaryTextDto,
  VaultSnapshotDto,
} from "../types/desktop";

export function invalidContract(): never {
  throw new Error("Nian Pass received an invalid desktop contract");
}

export function record(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidContract();
  }
  const object = value as Record<string, unknown>;
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    return invalidContract();
  }
  return object;
}

export function nonEmptyString(value: unknown): string {
  if (typeof value !== "string" || value === "") return invalidContract();
  return value;
}

export function stringValue(value: unknown): string {
  if (typeof value !== "string") return invalidContract();
  return value;
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return invalidContract();
  return value.map(nonEmptyString);
}

export function parseDesktopErrorCode(value: unknown): DesktopErrorCode {
  switch (value) {
    case "already_unlocked":
    case "locked":
    case "no_vault_selected":
    case "unlock_failed":
    case "unsupported_vault":
    case "entry_not_found":
    case "secret_unavailable":
    case "clipboard_failed":
    case "internal":
      return value;
    default:
      return invalidContract();
  }
}

export function parseSummaryText(value: unknown): SummaryTextDto {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalidContract();
  }
  const object = value as Record<string, unknown>;
  const kind = object["kind"];
  switch (kind) {
    case "missing":
      record(value, ["kind"]);
      return { kind };
    case "protected":
      record(value, ["kind"]);
      return { kind };
    case "visible": {
      const visible = record(value, ["kind", "value"]);
      return { kind, value: stringValue(visible["value"]) };
    }
    default:
      return invalidContract();
  }
}

export function parseSelectedVault(value: unknown): SelectedVaultDto {
  const object = record(value, ["fileName"]);
  return { fileName: nonEmptyString(object["fileName"]) };
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

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function validateRelations(snapshot: VaultSnapshotDto): void {
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
    if (!unique(group.childGroupIds) || !unique(group.entryIds))
      return invalidContract();
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

export function parseVaultSnapshot(value: unknown): VaultSnapshotDto {
  const object = record(value, ["rootGroupId", "groups", "entries"]);
  if (!Array.isArray(object["groups"]) || !Array.isArray(object["entries"])) {
    return invalidContract();
  }
  const snapshot: VaultSnapshotDto = {
    rootGroupId: nonEmptyString(object["rootGroupId"]),
    groups: object["groups"].map(parseGroup),
    entries: object["entries"].map(parseEntry),
  };
  validateRelations(snapshot);
  return snapshot;
}
