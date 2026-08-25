import { useEffect, useState } from "react";

import type { DesktopApi } from "../../lib/desktop";
import type {
  CustomFieldSummaryDto,
  EntryId,
  VaultSnapshotDto,
} from "../../types/desktop";
import { useSecretDraft } from "./useSecretDraft";

type FieldAction =
  | { kind: "add" }
  | { kind: "edit"; field: CustomFieldSummaryDto }
  | { kind: "delete"; field: CustomFieldSummaryDto };

interface CustomFieldsEditorProps {
  api: DesktopApi;
  entryId: EntryId;
  fields: CustomFieldSummaryDto[];
  disabled: boolean;
  onApplied: (snapshot: VaultSnapshotDto) => void;
}

export function CustomFieldsEditor({
  api,
  entryId,
  fields,
  disabled,
  onApplied,
}: CustomFieldsEditorProps) {
  const [action, setAction] = useState<FieldAction | null>(null);
  const [name, setName] = useState("");
  const [protection, setProtection] = useState<"protected" | "unprotected">(
    "protected",
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const value = useSecretDraft();
  const loadValue = value.load;

  useEffect(() => {
    if (action?.kind === "edit") {
      void loadValue(() =>
        api.revealEntryCustomField(entryId, action.field.name),
      );
    }
  }, [action, api, entryId, loadValue]);

  const close = () => {
    value.clear();
    setName("");
    setProtection("protected");
    setAction(null);
  };

  const apply = async () => {
    if (action === null || disabled || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const snapshot =
        action.kind === "delete"
          ? await api.deleteEntryCustomField(entryId, action.field.name)
          : await api.setEntryCustomField({
              entryId,
              name: action.kind === "add" ? name : action.field.name,
              value: value.value ?? "",
              protection:
                action.kind === "add" ? protection : action.field.protection,
            });
      close();
      onApplied(snapshot);
    } catch {
      close();
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="detail-field" aria-labelledby="custom-fields-label">
      <div className="section-heading-row">
        <h3 id="custom-fields-label">Custom fields</h3>
        <button
          className="compact-button"
          type="button"
          disabled={disabled}
          onClick={() => {
            setAction({ kind: "add" });
            value.set("");
          }}
        >
          Add custom field
        </button>
      </div>
      {fields.length === 0 ? <p>No custom fields.</p> : null}
      <ul className="custom-field-list">
        {fields.map((field) => (
          <li key={`${field.name}:${field.protection}`}>
            <span>{field.name}</span>
            <span>
              {field.protection === "protected" ? "Protected" : "Unprotected"}
            </span>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setAction({ kind: "edit", field });
              }}
            >
              Edit {field.name}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => {
                setAction({ kind: "delete", field });
              }}
            >
              Delete {field.name}
            </button>
          </li>
        ))}
      </ul>
      {failed ? <p role="alert">Could not change the custom field.</p> : null}

      {action !== null ? (
        <div className="modal-backdrop">
          <section
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="custom-field-dialog-title"
          >
            <h2 id="custom-field-dialog-title">
              {action.kind === "add"
                ? "Add custom field"
                : action.kind === "edit"
                  ? "Edit custom field value"
                  : "Delete custom field"}
            </h2>
            {action.kind === "delete" ? (
              <p>This custom field will be permanently removed.</p>
            ) : (
              <>
                {action.kind === "add" ? (
                  <>
                    <label htmlFor="custom-field-name">Field name</label>
                    <input
                      id="custom-field-name"
                      value={name}
                      onChange={(event) => {
                        setName(event.currentTarget.value);
                      }}
                    />
                    <label htmlFor="custom-field-protection">Protection</label>
                    <select
                      id="custom-field-protection"
                      value={protection}
                      onChange={(event) => {
                        setProtection(
                          event.currentTarget.value === "unprotected"
                            ? "unprotected"
                            : "protected",
                        );
                      }}
                    >
                      <option value="protected">Protected</option>
                      <option value="unprotected">Unprotected</option>
                    </select>
                  </>
                ) : null}
                <label htmlFor="custom-field-value">Value</label>
                <textarea
                  id="custom-field-value"
                  value={value.value ?? ""}
                  disabled={value.loading}
                  spellCheck={false}
                  onChange={(event) => {
                    value.set(event.currentTarget.value);
                  }}
                />
                {value.loading ? <p>Loading value…</p> : null}
                {value.failed ? (
                  <p role="alert">Could not load this value.</p>
                ) : null}
              </>
            )}
            <div className="dialog-actions">
              <button type="button" disabled={busy} onClick={close}>
                Cancel
              </button>
              <button
                className={action.kind === "delete" ? "danger-button" : ""}
                type="button"
                disabled={
                  busy ||
                  value.loading ||
                  (action.kind === "add" && name.trim() === "")
                }
                onClick={() => void apply()}
              >
                {busy
                  ? "Applying…"
                  : action.kind === "delete"
                    ? "Delete field"
                    : "Apply"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
