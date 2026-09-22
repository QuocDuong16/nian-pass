import type { VaultCoreSnapshotDto } from "../types/desktop";
import { invalidContract } from "./validation-primitives";

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export function validateSnapshotRelations(
  snapshot: VaultCoreSnapshotDto,
): void {
  const groups = new Map(snapshot.groups.map((group) => [group.id, group]));
  const entries = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
  if (
    groups.size !== snapshot.groups.length ||
    entries.size !== snapshot.entries.length ||
    !groups.has(snapshot.rootGroupId) ||
    (snapshot.recycleBinGroupId !== null &&
      (snapshot.recycleBinGroupId === snapshot.rootGroupId ||
        !groups.has(snapshot.recycleBinGroupId)))
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
