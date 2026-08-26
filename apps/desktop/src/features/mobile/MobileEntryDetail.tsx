import type { EntryDetailDto } from "../../types/desktop";
import { Summary } from "../vault/summary";

interface MobileEntryDetailProps {
  detail: EntryDetailDto;
}

export function MobileEntryDetail({ detail }: MobileEntryDetailProps) {
  return (
    <section className="mobile-detail" aria-labelledby="mobile-detail-title">
      <p className="eyebrow">Entry detail</p>
      <h2 id="mobile-detail-title">
        <Summary
          value={detail.title}
          missingLabel="Untitled entry"
          emptyLabel="Empty title"
        />
      </h2>
      <div className="detail-field">
        <h3>Username</h3>
        <Summary
          value={detail.username}
          missingLabel="No username"
          emptyLabel="Empty username"
        />
      </div>
      <div className="detail-field">
        <h3>URL</h3>
        <Summary
          value={detail.url}
          missingLabel="No URL"
          emptyLabel="Empty URL"
        />
      </div>
      <div className="detail-field">
        <h3>Stored fields</h3>
        <p>{detail.passwordPresent ? "Password stored" : "No password"}</p>
        <p>{detail.notesPresent ? "Notes stored" : "No notes"}</p>
      </div>
      <div className="detail-field">
        <h3>Custom fields</h3>
        {detail.customFields.length === 0 ? (
          <p>No custom fields</p>
        ) : (
          <ul className="custom-field-list">
            {detail.customFields.map((field) => (
              <li key={field.name}>
                <span>{field.name}</span>
                <span>{field.protection}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
