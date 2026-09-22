import { Button } from "../../components/Button";
import type { EntryDetailDto } from "../../types/desktop";
import { Summary } from "./summary";

interface EntryIdentityFieldsProps {
  detail: EntryDetailDto;
  disabled: boolean;
  copyDisabled: boolean;
  copyingUsername: boolean;
  copyingUrl: boolean;
  openingUrl: boolean;
  urlStatus: string | null;
  onCopyUsername: () => void;
  onCopyUrl: () => void;
  onOpenUrl: () => void;
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
        <div className="detail-value-row">
          <span className="detail-value">
            <Summary
              value={props.detail.url}
              missingLabel="No URL"
              emptyLabel="Empty URL"
            />
          </span>
          <div className="detail-inline-actions">
            <Button
              size="sm"
              variant="ghost"
              type="button"
              aria-label="Copy URL"
              disabled={
                props.disabled ||
                props.detail.url.kind === "missing" ||
                props.copyDisabled
              }
              onClick={props.onCopyUrl}
            >
              {props.copyingUrl ? "Copying…" : "Copy"}
            </Button>
            {props.detail.url.kind === "visible" &&
            props.detail.url.value !== "" ? (
              <Button
                size="sm"
                variant="ghost"
                type="button"
                aria-label="Open URL"
                disabled={props.disabled || props.openingUrl}
                onClick={props.onOpenUrl}
              >
                {props.openingUrl ? "Opening…" : "Open"}
              </Button>
            ) : null}
          </div>
        </div>
        {props.urlStatus === null ? null : (
          <p role="status">{props.urlStatus}</p>
        )}
      </section>
    </>
  );
}
