import { useCallback, useEffect, useState } from "react";

import { Button } from "../../components/Button";
import type {
  CustomFieldSummaryDto,
  EntryId,
  VaultCoreSnapshotDto,
} from "../../types/desktop";
import type { CustomFieldEditorApi } from "../../types/mutation-api";
import { requireLoaded } from "./custom-field-labels";
import { CustomFieldList } from "./CustomFieldList";
import { useSecretDraft } from "./useSecretDraft";
import { useSecurityFormTelemetry } from "./useSecurityFormTelemetry";

type FieldAction =
  | { kind: "add" }
  | { kind: "edit"; field: CustomFieldSummaryDto }
  | { kind: "delete"; field: CustomFieldSummaryDto };

interface CustomFieldsEditorProps<TSnapshot extends VaultCoreSnapshotDto> {
  api: CustomFieldEditorApi<TSnapshot>;
  entryId: EntryId;
  fields: CustomFieldSummaryDto[];
  disabled: boolean;
  onApplied: (snapshot: TSnapshot) => void;
  onDraftChange?: (active: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}

export function CustomFieldsEditor<TSnapshot extends VaultCoreSnapshotDto>({
  api,
  entryId,
  fields,
  disabled,
  onApplied,
  onDraftChange,
  onBusyChange,
}: CustomFieldsEditorProps<TSnapshot>) {
  const [action, setAction] = useState<FieldAction | null>(null);
  const [name, setName] = useState("");
  const [protection, setProtection] = useState<"protected" | "unprotected">(
    "protected",
  );
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const value = useSecretDraft();
  const loadValue = value.load;

  useSecurityFormTelemetry(action !== null, busy, onDraftChange, onBusyChange);

  const loadExistingValue = useCallback(
    (field: CustomFieldSummaryDto) =>
      loadValue(() => api.revealEntryCustomField(entryId, field.name)),
    [api, entryId, loadValue],
  );

  useEffect(() => {
    if (action?.kind === "edit") {
      void loadExistingValue(action.field);
    }
  }, [action, loadExistingValue]);

  const close = () => {
    value.clear();
    setName("");
    setProtection("protected");
    setAction(null);
  };

  const apply = async () => {
    if (action === null || disabled || busy) return;
    const draftValue = value.value;
    if (action.kind === "edit" && draftValue === null) return;
    setBusy(true);
    setFailed(false);
    try {
      const nextValue = action.kind === "add" ? (draftValue ?? "") : draftValue;
      const snapshot =
        action.kind === "delete"
          ? await api.deleteEntryCustomField(entryId, action.field.name)
          : await api.setEntryCustomField({
              entryId,
              name: action.kind === "add" ? name : action.field.name,
              value: requireLoaded(nextValue),
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
      <CustomFieldList
        fields={fields}
        disabled={disabled}
        onAdd={() => {
          setAction({ kind: "add" });
          value.set("");
        }}
        onEdit={(field) => {
          setAction({ kind: "edit", field });
        }}
        onDelete={(field) => {
          setAction({ kind: "delete", field });
        }}
      />
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
                {action.kind === "add" || value.value !== null ? (
                  <>
                    <label htmlFor="custom-field-value">Value</label>
                    <textarea
                      id="custom-field-value"
                      value={requireLoaded(value.value)}
                      spellCheck={false}
                      onChange={(event) => {
                        value.set(event.currentTarget.value);
                      }}
                    />
                  </>
                ) : null}
                {value.loading ? <p>Loading value…</p> : null}
                {value.failed ? (
                  <>
                    <p role="alert">Could not load this custom field value.</p>
                    {action.kind === "edit" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        type="button"
                        onClick={() => void loadExistingValue(action.field)}
                      >
                        Retry loading custom field value
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
            <div className="dialog-actions">
              <Button
                size="sm"
                variant="secondary"
                type="button"
                disabled={busy}
                onClick={close}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant={action.kind === "delete" ? "danger" : "primary"}
                type="button"
                disabled={
                  busy ||
                  value.loading ||
                  (action.kind === "edit" && value.value === null) ||
                  (action.kind === "add" && name.trim() === "")
                }
                onClick={() => void apply()}
              >
                {busy
                  ? "Applying…"
                  : action.kind === "delete"
                    ? "Delete field"
                    : "Apply"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
