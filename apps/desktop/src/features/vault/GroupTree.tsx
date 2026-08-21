import type { GroupDto } from "../../types/desktop";

interface GroupTreeProps {
  rootGroupId: string;
  groupsById: ReadonlyMap<string, GroupDto>;
  selectedGroupId: string;
  onSelect: (groupId: string) => void;
}

interface GroupNodeProps extends Omit<GroupTreeProps, "rootGroupId"> {
  groupId: string;
}

function GroupNode({ groupId, groupsById, selectedGroupId, onSelect }: GroupNodeProps) {
  const group = groupsById.get(groupId);
  if (group === undefined) {
    return null;
  }

  return (
    <li>
      <button
        className={group.id === selectedGroupId ? "group-button selected" : "group-button"}
        type="button"
        aria-current={group.id === selectedGroupId ? "true" : undefined}
        onClick={() => {
          onSelect(group.id);
        }}
      >
        <span className="folder-glyph" aria-hidden="true">▸</span>
        <span>{group.name || "Unnamed group"}</span>
      </button>
      {group.childGroupIds.length > 0 ? (
        <ul>
          {group.childGroupIds.map((childId) => (
            <GroupNode
              key={childId}
              groupId={childId}
              groupsById={groupsById}
              selectedGroupId={selectedGroupId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function GroupTree(props: GroupTreeProps) {
  return (
    <nav className="group-sidebar" aria-label="Vault groups">
      <h2>Groups</h2>
      <ul className="group-tree">
        <GroupNode groupId={props.rootGroupId} {...props} />
      </ul>
    </nav>
  );
}
