export function VaultEmptyDetail() {
  return (
    <aside className="detail-pane detail-empty" aria-label="Entry detail">
      <div className="detail-empty-content">
        <span className="detail-empty-mark" aria-hidden="true">
          N
        </span>
        <strong>No entry selected</strong>
        <span>Select an entry to view its safe details.</span>
      </div>
    </aside>
  );
}
