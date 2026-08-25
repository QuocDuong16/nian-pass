import type { SummaryTextDto } from "../../types/desktop";
import type { SecretDraft } from "./useSecretDraft";

interface EditableMetadataFieldProps {
  label: string;
  summary: SummaryTextDto;
  draft: SecretDraft;
  disabled: boolean;
  load: () => Promise<string>;
}

export function EditableMetadataField({
  label,
  summary,
  draft,
  disabled,
  load,
}: EditableMetadataFieldProps) {
  const initial = summary.kind === "visible" ? summary.value : "";
  const value =
    summary.kind === "protected" ? draft.value : (draft.value ?? initial);

  return (
    <div className="form-field">
      <label htmlFor={`edit-${label.toLowerCase()}`}>{label}</label>
      {value === null ? (
        <button
          className="compact-button"
          type="button"
          disabled={disabled || draft.loading}
          onClick={() => void draft.load(load)}
        >
          {draft.loading ? `Loading ${label}…` : `Load protected ${label}`}
        </button>
      ) : (
        <input
          id={`edit-${label.toLowerCase()}`}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            draft.set(event.currentTarget.value);
          }}
        />
      )}
      {draft.failed ? (
        <p className="detail-error" role="alert">
          Could not load this protected field.
        </p>
      ) : null}
    </div>
  );
}
