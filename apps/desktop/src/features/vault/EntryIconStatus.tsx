import type { EntryIconDto } from "../../types/desktop";
import { entryIconLabel } from "./entry-icons";

export function EntryIconStatus({ icon }: { icon: EntryIconDto }) {
  return (
    <section className="detail-field" aria-labelledby="entry-icon-status-label">
      <h3 id="entry-icon-status-label">Icon</h3>
      <p>{entryIconLabel(icon)}</p>
    </section>
  );
}
