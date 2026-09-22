import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

import type { GroupDto } from "../../types/desktop";

interface GroupTreeProps {
  rootGroupId: string;
  groupsById: ReadonlyMap<string, GroupDto>;
  recycleBinGroupId?: string | null | undefined;
  selectedGroupId: string;
  onSelect: (groupId: string) => void;
}

interface GroupNodeProps extends Omit<GroupTreeProps, "rootGroupId"> {
  groupId: string;
  parentGroupId: string | null;
  collapsedGroupIds: ReadonlySet<string>;
  onToggleCollapsed: (groupId: string) => void;
}

function containsGroup(
  groupsById: ReadonlyMap<string, GroupDto>,
  ancestorGroupId: string,
  candidateGroupId: string,
): boolean {
  const pending = [...(groupsById.get(ancestorGroupId)?.childGroupIds ?? [])];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const groupId = pending.pop();
    if (groupId === undefined || seen.has(groupId)) continue;
    if (groupId === candidateGroupId) return true;
    seen.add(groupId);
    pending.push(...(groupsById.get(groupId)?.childGroupIds ?? []));
  }
  return false;
}

function visibleNavigationTarget(
  source: HTMLButtonElement,
  key: string,
): HTMLButtonElement | null {
  const navigation = source.closest("nav");
  if (navigation === null) return null;
  const buttons = Array.from(
    navigation.querySelectorAll<HTMLButtonElement>(".group-button"),
  );
  const currentIndex = buttons.indexOf(source);
  if (currentIndex < 0) return null;

  let targetIndex: number;
  switch (key) {
    case "ArrowDown":
      targetIndex = Math.min(currentIndex + 1, buttons.length - 1);
      break;
    case "ArrowUp":
      targetIndex = Math.max(currentIndex - 1, 0);
      break;
    case "Home":
      targetIndex = 0;
      break;
    case "End":
      targetIndex = buttons.length - 1;
      break;
    default:
      return null;
  }
  return buttons[targetIndex] ?? null;
}

function groupButtonById(
  source: HTMLButtonElement,
  groupId: string,
): HTMLButtonElement | null {
  const navigation = source.closest("nav");
  if (navigation === null) return null;
  return (
    Array.from(
      navigation.querySelectorAll<HTMLButtonElement>(".group-button"),
    ).find((button) => button.dataset["groupId"] === groupId) ?? null
  );
}

function GroupNode({
  groupId,
  parentGroupId,
  groupsById,
  recycleBinGroupId,
  selectedGroupId,
  onSelect,
  collapsedGroupIds,
  onToggleCollapsed,
}: GroupNodeProps) {
  const group = groupsById.get(groupId);
  if (group === undefined) {
    return null;
  }

  const hasChildren = group.childGroupIds.length > 0;
  const collapsed = hasChildren && collapsedGroupIds.has(group.id);
  const displayName =
    group.id === recycleBinGroupId ? "Trash" : group.name || "Unnamed group";
  const childListId = `group-children-${group.id}`;

  return (
    <li>
      <div className="group-row">
        {hasChildren ? (
          <button
            className="group-disclosure"
            type="button"
            aria-label={`${collapsed ? "Expand" : "Collapse"} ${displayName}`}
            aria-expanded={!collapsed}
            aria-controls={childListId}
            onClick={() => {
              if (
                !collapsed &&
                group.id !== selectedGroupId &&
                containsGroup(groupsById, group.id, selectedGroupId)
              ) {
                onSelect(group.id);
              }
              onToggleCollapsed(group.id);
            }}
          >
            <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
          </button>
        ) : (
          <span className="group-disclosure-placeholder" aria-hidden="true" />
        )}
        <button
          className={
            group.id === selectedGroupId
              ? "group-button selected"
              : "group-button"
          }
          type="button"
          data-group-id={group.id}
          aria-current={group.id === selectedGroupId ? "true" : undefined}
          onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
            const visibleTarget = visibleNavigationTarget(
              event.currentTarget,
              event.key,
            );
            if (visibleTarget !== null) {
              event.preventDefault();
              visibleTarget.focus();
              const targetGroupId = visibleTarget.dataset["groupId"];
              if (targetGroupId !== undefined && targetGroupId !== group.id) {
                onSelect(targetGroupId);
              }
              return;
            }

            if (event.key === "ArrowRight" && hasChildren) {
              event.preventDefault();
              if (collapsed) {
                onToggleCollapsed(group.id);
                return;
              }
              const childGroupId = group.childGroupIds[0];
              if (childGroupId !== undefined) {
                onSelect(childGroupId);
                groupButtonById(event.currentTarget, childGroupId)?.focus();
              }
              return;
            }

            if (event.key === "ArrowLeft") {
              if (hasChildren && !collapsed) {
                event.preventDefault();
                if (
                  group.id !== selectedGroupId &&
                  containsGroup(groupsById, group.id, selectedGroupId)
                ) {
                  onSelect(group.id);
                }
                onToggleCollapsed(group.id);
                return;
              }
              if (parentGroupId !== null) {
                event.preventDefault();
                onSelect(parentGroupId);
                groupButtonById(event.currentTarget, parentGroupId)?.focus();
              }
            }
          }}
          onClick={() => {
            onSelect(group.id);
          }}
        >
          <span className="group-name">{displayName}</span>
          <span className="group-count" aria-hidden="true">
            {group.entryIds.length}
          </span>
        </button>
      </div>
      {hasChildren && !collapsed ? (
        <ul id={childListId}>
          {group.childGroupIds.map((childId) => (
            <GroupNode
              key={childId}
              groupId={childId}
              parentGroupId={group.id}
              groupsById={groupsById}
              recycleBinGroupId={recycleBinGroupId}
              selectedGroupId={selectedGroupId}
              onSelect={onSelect}
              collapsedGroupIds={collapsedGroupIds}
              onToggleCollapsed={onToggleCollapsed}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function GroupTree(props: GroupTreeProps) {
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(
    () => new Set(),
  );

  return (
    <nav className="group-sidebar" aria-label="Vault groups">
      <ul className="group-tree">
        <GroupNode
          groupId={props.rootGroupId}
          parentGroupId={null}
          {...props}
          collapsedGroupIds={collapsedGroupIds}
          onToggleCollapsed={(groupId) => {
            setCollapsedGroupIds((current) => {
              const next = new Set(current);
              if (next.has(groupId)) next.delete(groupId);
              else next.add(groupId);
              return next;
            });
          }}
        />
      </ul>
    </nav>
  );
}
