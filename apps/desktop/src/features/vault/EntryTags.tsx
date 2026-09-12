interface EntryTagsProps {
  tags: string[];
}

export function EntryTags({ tags }: EntryTagsProps) {
  if (tags.length === 0) return null;
  return (
    <section className="detail-field" aria-labelledby="tags-label">
      <h3 id="tags-label">Tags</h3>
      <div className="tag-list">
        {tags.map((tag) => (
          <span className="tag-chip" key={tag}>
            {tag}
          </span>
        ))}
      </div>
    </section>
  );
}
