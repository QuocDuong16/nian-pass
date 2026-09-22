import { useMemo, useState } from "react";

import type {
  GroupDto,
  GroupId,
  VaultCoreSnapshotDto,
} from "../../types/desktop";
import type { GroupActionsApi } from "../../types/mutation-api";
import { GroupActionDialog, type GroupAction } from "./GroupActionDialog";
import { isGroupInRecycleBin, isRecycleBinRoot } from "./recycle-bin";
import { useSecurityFormTelemetry } from "./useSecurityFormTelemetry";

interface GroupActionsProps<TSnapshot extends VaultCoreSnapshotDto> {
  api: GroupActionsApi<TSnapshot>;
  group: GroupDto;
  snapshot: TSnapshot;
  disabled: boolean;
  onChanged: (snapshot: TSnapshot, selectedGroupId: GroupId) => void;
  onDraftChange?: (active: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}

export function GroupActions<TSnapshot extends VaultCoreSnapshotDto>({
  api,
  group,
  snapshot,
  disabled,
  onChanged,
  onDraftChange,
  onBusyChange,
}: GroupActionsProps<TSnapshot>) {
  const [action, setAction] = useState<GroupAction | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [name, setName] = useState("");
  const [destination, setDestination] = useState(snapshot.rootGroupId);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const groupsById = useMemo(
    () => new Map(snapshot.groups.map((item) => [item.id, item])),
    [snapshot.groups],
  );
  const recycled = isGroupInRecycleBin(snapshot, group.id);
  const recycleRoot = isRecycleBinRoot(snapshot, group.id);
  const root = group.id === snapshot.rootGroupId;
  const parentId = useMemo(() => {
    for (const candidate of snapshot.groups) {
      if (candidate.childGroupIds.includes(group.id)) return candidate.id;
    }
    return snapshot.rootGroupId;
  }, [group.id, snapshot.groups, snapshot.rootGroupId]);
  const destinations = useMemo(() => {
    const invalid = new Set([group.id]);
    const visit = (id: string) => {
      const item = groupsById.get(id);
      item?.childGroupIds.forEach((child) => {
        invalid.add(child);
        visit(child);
      });
    };
    visit(group.id);
    return snapshot.groups.filter(
      (candidate) =>
        !invalid.has(candidate.id) &&
        !isGroupInRecycleBin(snapshot, candidate.id),
    );
  }, [group.id, groupsById, snapshot]);

  useSecurityFormTelemetry(action !== null, busy, onDraftChange, onBusyChange);

  const open = (next: GroupAction) => {
    setFailed(false);
    setMenuOpen(false);
    setAction(next);
    setName(next === "rename" ? group.name : "");
    setDestination(destinations[0]?.id ?? snapshot.rootGroupId);
  };

  const run = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await operation();
      setAction(null);
      setMenuOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const restore = () => {
    if (api.restoreGroup === undefined) return;
    void run(async () => {
      const next = await api.restoreGroup?.(group.id);
      if (next !== undefined) onChanged(next, group.id);
    });
  };

  const apply = () => {
    if (action === null) return;
    void run(async () => {
      if (action === "create") {
        const result = await api.createGroup(group.id, name);
        onChanged(result.snapshot, result.createdGroupId);
      } else if (action === "rename") {
        onChanged(await api.renameGroup(group.id, name), group.id);
      } else if (action === "move") {
        onChanged(await api.moveGroup(group.id, destination), group.id);
      } else if (action === "trash") {
        onChanged(await api.deleteGroup(group.id), parentId);
      } else if (api.permanentlyDeleteGroup !== undefined) {
        const next = await api.permanentlyDeleteGroup(group.id);
        onChanged(next, next.recycleBinGroupId ?? next.rootGroupId);
      }
    });
  };

  if (recycleRoot) {
    return (
      <div className="group-actions recycle-bin-actions">
        <span>Items here stay recoverable until permanently deleted.</span>
      </div>
    );
  }

  return (
    <div className="group-actions" aria-label="Group operations">
      <button
        className="group-menu-trigger"
        type="button"
        aria-label="Group actions"
        disabled={disabled || busy}
        aria-expanded={menuOpen}
        onClick={() => {
          setMenuOpen((value) => !value);
        }}
      >
        Actions
      </button>
      {menuOpen ? (
        <div className="group-action-menu" role="menu">
          {recycled ? (
            <>
              {api.restoreGroup === undefined ? null : (
                <button type="button" role="menuitem" onClick={restore}>
                  Restore group
                </button>
              )}
              {api.permanentlyDeleteGroup === undefined ? null : (
                <button
                  className="danger-button"
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    open("permanent-delete");
                  }}
                >
                  Delete permanently
                </button>
              )}
            </>
          ) : (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  open("create");
                }}
              >
                New group
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  open("rename");
                }}
              >
                Rename group
              </button>
              {!root ? (
                <>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      open("move");
                    }}
                  >
                    Move group
                  </button>
                  {snapshot.recycleBinEnabled ? (
                    <button
                      className="danger-button"
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        open("trash");
                      }}
                    >
                      Move group to Trash
                    </button>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}
      {failed ? (
        <p role="alert">Could not complete the group operation.</p>
      ) : null}

      {action !== null ? (
        <GroupActionDialog
          action={action}
          busy={busy}
          name={name}
          destination={destination}
          destinations={destinations}
          onName={setName}
          onDestination={setDestination}
          onCancel={() => {
            setAction(null);
          }}
          onApply={apply}
        />
      ) : null}
    </div>
  );
}
