import type { GroupId, VaultCoreSnapshotDto } from "../../types/desktop";

export function isGroupInRecycleBin(
  snapshot: VaultCoreSnapshotDto,
  groupId: GroupId,
): boolean {
  const recycleBinGroupId = snapshot.recycleBinGroupId;
  if (recycleBinGroupId === null) return false;
  const parents = new Map<string, string>();
  for (const group of snapshot.groups) {
    for (const childId of group.childGroupIds) parents.set(childId, group.id);
  }
  let current: string | undefined = groupId;
  while (current !== undefined) {
    if (current === recycleBinGroupId) return true;
    current = parents.get(current);
  }
  return false;
}

export function isRecycleBinRoot(
  snapshot: VaultCoreSnapshotDto,
  groupId: GroupId,
): boolean {
  return snapshot.recycleBinGroupId === groupId;
}
