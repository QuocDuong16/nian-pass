import { useEffect, useState } from "react";

import type { EntryDetailDto, GroupDto } from "../../types/desktop";
import type { MobileApi, MobileVaultSnapshotDto } from "../../types/mobile";
import { CustomFieldsEditor } from "../vault/CustomFieldsEditor";
import { EntryActions } from "../vault/EntryActions";
import { EntryEditForm } from "../vault/EntryEditForm";
import { EntryIconStatus } from "../vault/EntryIconStatus";
import { EntryTagsSection } from "../vault/EntryTagsSection";
import { Summary } from "../vault/summary";
import { MobileEntryAttachmentsSection } from "./MobileEntryAttachmentsSection";
import { MobileEntryHistorySection } from "./MobileEntryHistorySection";
import { MobileTotpSection } from "./MobileTotpSection";

interface MobileEntryDetailProps {
  api: MobileApi;
  detail: EntryDetailDto;
  groups: GroupDto[];
  disabled: boolean;
  readOnly?: boolean;
  nativeAttachmentActions: boolean;
  onSnapshot: (snapshot: MobileVaultSnapshotDto) => void;
  onDeleted: (snapshot: MobileVaultSnapshotDto) => void;
  onMoved: (snapshot: MobileVaultSnapshotDto, destination: string) => void;
  onDraftChange: (active: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}

export function MobileEntryDetail(props: MobileEntryDetailProps) {
  const { onBusyChange, onDraftChange } = props;
  const [editing, setEditing] = useState(false);
  const [fieldDraft, setFieldDraft] = useState(false);
  const [actionDraft, setActionDraft] = useState(false);
  const [totpDraft, setTotpDraft] = useState(false);
  const [tagsDraft, setTagsDraft] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [fieldBusy, setFieldBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [totpBusy, setTotpBusy] = useState(false);
  const [tagsBusy, setTagsBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [attachmentsBusy, setAttachmentsBusy] = useState(false);

  useEffect(() => {
    onDraftChange(
      editing || fieldDraft || actionDraft || totpDraft || tagsDraft,
    );
    return () => {
      onDraftChange(false);
    };
  }, [actionDraft, editing, fieldDraft, onDraftChange, tagsDraft, totpDraft]);
  useEffect(() => {
    onBusyChange(
      editBusy ||
        fieldBusy ||
        actionBusy ||
        totpBusy ||
        historyBusy ||
        attachmentsBusy ||
        tagsBusy,
    );
    return () => {
      onBusyChange(false);
    };
  }, [
    actionBusy,
    attachmentsBusy,
    editBusy,
    fieldBusy,
    historyBusy,
    onBusyChange,
    tagsBusy,
    totpBusy,
  ]);

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
      <EntryIconStatus icon={props.detail.icon} />
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
      <EntryTagsSection
        key={`tags-${props.detail.id}`}
        api={props.api}
        entryId={props.detail.id}
        tags={props.detail.tags}
        disabled={props.disabled}
        readOnly={props.readOnly === true}
        onSnapshot={props.onSnapshot}
        onDraftChange={setTagsDraft}
        onBusyChange={setTagsBusy}
      />
      <div className="detail-field">
        <h3>Stored fields</h3>
        <p>
          {props.detail.passwordPresent ? "Password stored" : "No password"}
        </p>
        <p>{props.detail.notesPresent ? "Notes stored" : "No notes"}</p>
      </div>
      <MobileTotpSection
        key={props.detail.id}
        api={props.api}
        detail={props.detail}
        disabled={props.disabled}
        readOnly={props.readOnly === true}
        onSnapshot={props.onSnapshot}
        onDraftChange={setTotpDraft}
        onBusyChange={setTotpBusy}
      />
      <MobileEntryHistorySection
        key={`history-${props.detail.id}`}
        api={props.api}
        entryId={props.detail.id}
        disabled={props.disabled}
        onBusyChange={setHistoryBusy}
      />
      <MobileEntryAttachmentsSection
        key={`attachments-${props.detail.id}`}
        api={props.api}
        entryId={props.detail.id}
        disabled={props.disabled}
        readOnly={props.readOnly === true}
        nativeActions={props.nativeAttachmentActions}
        onSnapshot={props.onSnapshot}
        onBusyChange={setAttachmentsBusy}
      />
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
