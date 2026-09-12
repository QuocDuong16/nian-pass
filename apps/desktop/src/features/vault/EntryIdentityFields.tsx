import { Button } from "../../components/Button";
import type { EntryDetailDto } from "../../types/desktop";
import { EntryTags } from "./EntryTags";
import { Summary } from "./summary";

interface EntryIdentityFieldsProps {
  detail: EntryDetailDto;
  disabled: boolean;
  copyDisabled: boolean;
  copyingUsername: boolean;
  onCopyUsername: () => void;
}

export function EntryIdentityFields(props: EntryIdentityFieldsProps) {
  return (
    <>
      <section className="detail-field" aria-labelledby="username-label">
        <h3 id="username-label">Username</h3>
        <div className="detail-value-row">
          <span className="detail-value">
            <Summary
              value={props.detail.username}
              missingLabel="No username"
              emptyLabel="Empty username"
            />
          </span>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            aria-label="Copy username"
            disabled={
              props.disabled ||
              props.detail.username.kind === "missing" ||
              props.copyDisabled
            }
            onClick={props.onCopyUsername}
          >
            {props.copyingUsername ? "Copying…" : "Copy"}
          </Button>
        </div>
      </section>
      <section className="detail-field" aria-labelledby="url-label">
        <h3 id="url-label">URL</h3>
        <Summary
          value={props.detail.url}
          missingLabel="No URL"
          emptyLabel="Empty URL"
        />
      </section>
      <EntryTags tags={props.detail.tags} />
    </>
  );
}
