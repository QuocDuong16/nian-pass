interface EntryTagsProps {
  tags: string[];
}

export function EntryTags({ tags }: EntryTagsProps) {
  if (tags.length === 0) return null;
  return (
    <div className="tag-list">
      {tags.map((tag) => (
        <span className="tag-chip" key={tag}>
          {tag}
        </span>
      ))}
    </div>
  );
}
