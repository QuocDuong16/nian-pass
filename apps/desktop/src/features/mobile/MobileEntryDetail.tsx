import { useEffect, useState } from "react";

import type {
  EntryDetailDto,
  GroupDto,
  VaultSnapshotDto,
} from "../../types/desktop";
import type { MobileApi } from "../../types/mobile";
import { CustomFieldsEditor } from "../vault/CustomFieldsEditor";
import { EntryActions } from "../vault/EntryActions";
import { EntryEditForm } from "../vault/EntryEditForm";
import { Summary } from "../vault/summary";

interface MobileEntryDetailProps {
  api: MobileApi;
  detail: EntryDetailDto;
  groups: GroupDto[];
  disabled: boolean;
  readOnly?: boolean;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
  onDeleted: (snapshot: VaultSnapshotDto) => void;
  onMoved: (snapshot: VaultSnapshotDto, destination: string) => void;
  onDraftChange: (active: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}

export function MobileEntryDetail(props: MobileEntryDetailProps) {
  const { onBusyChange, onDraftChange } = props;
  const [editing, setEditing] = useState(false);
  const [fieldDraft, setFieldDraft] = useState(false);
  const [actionDraft, setActionDraft] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [fieldBusy, setFieldBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    onDraftChange(editing || fieldDraft || actionDraft);
    return () => {
      onDraftChange(false);
    };
  }, [actionDraft, editing, fieldDraft, onDraftChange]);
  useEffect(() => {
    onBusyChange(editBusy || fieldBusy || actionBusy);
    return () => {
      onBusyChange(false);
    };
  }, [actionBusy, editBusy, fieldBusy, onBusyChange]);

  if (editing) {
    return (
      <section className="mobile-detail">
        <EntryEditForm
          api={props.api}
          detail={props.detail}
          disabled={props.disabled}
          onBusyChange={setEditBusy}
          onCancel={() => {
            setEditing(false);
          }}
          onApplied={(snapshot) => {
            setEditing(false);
            props.onSnapshot(snapshot);
          }}
        />
      </section>
    );
  }

  return (
    <section className="mobile-detail" aria-labelledby="mobile-detail-title">
      <p className="eyebrow">Entry detail</p>
      <h2 id="mobile-detail-title">
        <Summary
          value={props.detail.title}
          missingLabel="Untitled entry"
          emptyLabel="Empty title"
        />
      </h2>
      <div className="detail-field">
        <h3>Username</h3>
        <Summary
          value={props.detail.username}
          missingLabel="No username"
          emptyLabel="Empty username"
        />
      </div>
      <div className="detail-field">
        <h3>URL</h3>
        <Summary
          value={props.detail.url}
          missingLabel="No URL"
          emptyLabel="Empty URL"
        />
      </div>
      <div className="detail-field">
        <h3>Stored fields</h3>
        <p>
          {props.detail.passwordPresent ? "Password stored" : "No password"}
        </p>
        <p>{props.detail.notesPresent ? "Notes stored" : "No notes"}</p>
      </div>
      {props.readOnly === true ? null : (
        <button
          type="button"
          disabled={props.disabled}
          onClick={() => {
            setEditing(true);
          }}
        >
          Edit entry
        </button>
      )}
      {props.readOnly === true ? null : (
        <CustomFieldsEditor
          api={props.api}
          entryId={props.detail.id}
          fields={props.detail.customFields}
          disabled={props.disabled}
          onApplied={props.onSnapshot}
          onDraftChange={setFieldDraft}
          onBusyChange={setFieldBusy}
        />
      )}
      {props.readOnly === true && props.detail.customFields.length > 0 ? (
        <div className="detail-field">
          <h3>Custom fields</h3>
          <ul>
            {props.detail.customFields.map((field) => (
              <li key={field.name}>
                {field.name} · {field.protection}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {props.readOnly === true ? null : (
        <EntryActions
          api={props.api}
          detail={props.detail}
          groups={props.groups}
          disabled={props.disabled}
          onDeleted={props.onDeleted}
          onMoved={props.onMoved}
          onDraftChange={setActionDraft}
          onBusyChange={setActionBusy}
        />
      )}
    </section>
  );
}
