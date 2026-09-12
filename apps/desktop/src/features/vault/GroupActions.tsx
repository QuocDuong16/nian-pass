import { useMemo, useState } from "react";

import type {
  GroupDto,
  GroupId,
  VaultCoreSnapshotDto,
} from "../../types/desktop";
import type { GroupActionsApi } from "../../types/mutation-api";
import { useSecurityFormTelemetry } from "./useSecurityFormTelemetry";

type GroupAction = "create" | "rename" | "move" | "delete";

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
  const parentId = useMemo(() => {
    for (const candidate of snapshot.groups) {
      if (candidate.childGroupIds.includes(group.id)) return candidate.id;
    }
    return snapshot.rootGroupId;
  }, [group.id, snapshot.groups, snapshot.rootGroupId]);
  const invalidDestinations = useMemo(() => {
    const invalid = new Set([group.id]);
    const visit = (id: string) => {
      const item = groupsById.get(id);
      item?.childGroupIds.forEach((child) => {
        invalid.add(child);
        visit(child);
      });
    };
    visit(group.id);
    return invalid;
  }, [group.id, groupsById]);
  const destinations = snapshot.groups.filter(
    (candidate) => !invalidDestinations.has(candidate.id),
  );

  useSecurityFormTelemetry(action !== null, busy, onDraftChange, onBusyChange);

  const open = (next: GroupAction) => {
    setFailed(false);
    setMenuOpen(false);
    setAction(next);
    setName(next === "rename" ? group.name : "");
    setDestination(destinations[0]?.id ?? snapshot.rootGroupId);
  };

  const apply = async () => {
    if (action === null || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      if (action === "create") {
        const result = await api.createGroup(group.id, name);
        onChanged(result.snapshot, result.createdGroupId);
      } else if (action === "rename") {
        onChanged(await api.renameGroup(group.id, name), group.id);
      } else if (action === "move") {
        onChanged(await api.moveGroup(group.id, destination), group.id);
      } else {
        onChanged(await api.deleteGroup(group.id), parentId);
      }
      setAction(null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const root = group.id === snapshot.rootGroupId;
  return (
    <div className="group-actions" aria-label="Group operations">
      <button
        className="group-menu-trigger"
        type="button"
        aria-label="Group actions"
        disabled={disabled}
        aria-expanded={menuOpen}
        onClick={() => {
          setMenuOpen((value) => !value);
        }}
      >
        Actions
      </button>
      {menuOpen ? (
        <div className="group-action-menu" role="menu">
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
              <button
                className="danger-button"
                type="button"
                role="menuitem"
                onClick={() => {
                  open("delete");
                }}
              >
                Permanently delete group
              </button>
            </>
          ) : null}
        </div>
      ) : null}
      {failed ? (
        <p role="alert">Could not complete the group operation.</p>
      ) : null}

      {action !== null ? (
        <div className="modal-backdrop">
          <section
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="group-action-title"
          >
            <h2 id="group-action-title">
              {action === "create"
                ? "New group"
                : action === "rename"
                  ? "Rename group"
                  : action === "move"
                    ? "Move group"
                    : "Permanently delete group?"}
            </h2>
            {action === "delete" ? (
              <p>
                The group, every descendant group, and every contained entry
                will be permanently removed. Deletion tombstones will be
                recorded. M4.3 has no recycle-bin UI.
              </p>
            ) : action === "move" ? (
              <>
                <label htmlFor="group-destination">Destination parent</label>
                <select
                  id="group-destination"
                  value={destination}
                  onChange={(event) => {
                    setDestination(event.currentTarget.value);
                  }}
                >
                  {destinations.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name || "Unnamed group"}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <label htmlFor="group-name">Group name</label>
                <input
                  id="group-name"
                  value={name}
                  onChange={(event) => {
                    setName(event.currentTarget.value);
                  }}
                />
              </>
            )}
            <div className="dialog-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setAction(null);
                }}
              >
                Cancel
              </button>
              <button
                className={action === "delete" ? "danger-button" : ""}
                type="button"
                disabled={
                  busy ||
                  ((action === "create" || action === "rename") &&
                    name.trim() === "") ||
                  (action === "move" && destination === "")
                }
                onClick={() => void apply()}
              >
                {busy
                  ? "Applying…"
                  : action === "delete"
                    ? "Permanently delete group"
                    : "Apply"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
