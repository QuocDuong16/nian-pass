import { useEffect, useState } from "react";

import type { DesktopApi } from "../../lib/desktop";
import type {
  CreatedEntryDto,
  EntryDetailDto,
  GroupDto,
  GroupId,
  VaultSnapshotDto,
} from "../../types/desktop";
import { CustomFieldsEditor } from "./CustomFieldsEditor";
import { EntryActions } from "./EntryActions";
import { EntryAttachmentsSection } from "./EntryAttachmentsSection";
import { EntryCustomIconSection } from "./EntryCustomIconSection";
import { EntryDetailHeader } from "./EntryDetailHeader";
import { EntryExpiryStatus } from "./EntryExpiryStatus";
import { EntryHistorySection } from "./EntryHistorySection";
import { EntryIdentityFields } from "./EntryIdentityFields";
import { EntryNotesSection } from "./EntryNotesSection";
import { EntryPasswordField } from "./EntryPasswordField";
import { EntryTagsSection } from "./EntryTagsSection";
import { EntryTotpSection } from "./EntryTotpSection";
import { useEntryClipboard } from "./useEntryClipboard";
import { useSecretReveal } from "./useSecretReveal";
import { useEntryUrlOpen } from "./useEntryUrlOpen";
import { useSecurityFormTelemetry } from "./useSecurityFormTelemetry";

interface EntryReadViewProps {
  api: DesktopApi;
  detail: EntryDetailDto;
  groups: GroupDto[];
  disabled: boolean;
  mutationDisabled?: boolean;
  recycled?: boolean;
  recycleBinEnabled?: boolean;
  onEdit: () => void;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
  onDeleted: (snapshot: VaultSnapshotDto) => void;
  onDuplicated?: ((result: CreatedEntryDto) => void) | undefined;
  onMoved: (snapshot: VaultSnapshotDto, destination: GroupId) => void;
  onDraftChange?: (active: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  clearRevealsVersion?: number;
}

export function EntryReadView({
  api,
  detail,
  groups,
  disabled,
  mutationDisabled = false,
  recycled = false,
  recycleBinEnabled = true,
  onEdit,
  onSnapshot,
  onDeleted,
  onDuplicated,
  onMoved,
  onDraftChange,
  onBusyChange,
  clearRevealsVersion = 0,
}: EntryReadViewProps) {
  const clipboard = useEntryClipboard({
    api,
    entryId: detail.id,
    disabled,
  });
  const [customFieldDraft, setCustomFieldDraft] = useState(false);
  const [entryActionDraft, setEntryActionDraft] = useState(false);
  const [totpDraft, setTotpDraft] = useState(false);
  const [historyDraft, setHistoryDraft] = useState(false);
  const [tagDraft, setTagDraft] = useState(false);
  const [customFieldBusy, setCustomFieldBusy] = useState(false);
  const [entryActionBusy, setEntryActionBusy] = useState(false);
  const [totpBusy, setTotpBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [tagBusy, setTagBusy] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [iconBusy, setIconBusy] = useState(false);
  const password = useSecretReveal({
    entryId: detail.id,
    disabled,
    load: api.revealEntryPassword,
  });
  const clearPassword = password.clear;

  const urlOpen = useEntryUrlOpen({
    api,
    entryId: detail.id,
    url: detail.url,
    disabled,
  });

  useSecurityFormTelemetry(
    customFieldDraft ||
      entryActionDraft ||
      totpDraft ||
      historyDraft ||
      tagDraft,
    customFieldBusy ||
      entryActionBusy ||
      totpBusy ||
      historyBusy ||
      tagBusy ||
      attachmentBusy ||
      iconBusy ||
      urlOpen.opening ||
      clipboard.copying !== null,
    onDraftChange,
    onBusyChange,
  );

  useEffect(() => {
    clearPassword();
  }, [clearPassword, clearRevealsVersion]);

  return (
    <>
      <EntryDetailHeader
        title={detail.title}
        editDisabled={disabled || mutationDisabled || recycled}
        copyDisabled={disabled || clipboard.copying !== null}
        copying={clipboard.copying === "title"}
        onEdit={onEdit}
        onCopy={() => void clipboard.copy("title")}
      />
      <EntryIdentityFields
        detail={detail}
        disabled={disabled}
        copyDisabled={clipboard.copying !== null}
        copyingUsername={clipboard.copying === "username"}
        copyingUrl={clipboard.copying === "url"}
        openingUrl={urlOpen.opening}
        urlStatus={urlOpen.status}
        onCopyUsername={() => void clipboard.copy("username")}
        onCopyUrl={() => void clipboard.copy("url")}
        onOpenUrl={() => void urlOpen.open()}
      />
      <EntryTagsSection
        key={`tags-${detail.id}`}
        api={api}
        entryId={detail.id}
        tags={detail.tags}
        disabled={disabled || mutationDisabled || recycled}
        onSnapshot={onSnapshot}
        onDraftChange={setTagDraft}
        onBusyChange={setTagBusy}
      />
      <EntryPasswordField
        disabled={disabled}
        passwordPresent={detail.passwordPresent}
        password={password}
        copying={clipboard.copying === "password"}
        copyDisabled={clipboard.copying !== null}
        onCopy={() => void clipboard.copy("password")}
      />
      <EntryTotpSection
        api={api}
        detail={detail}
        disabled={disabled}
        mutationDisabled={mutationDisabled}
        recycled={recycled}
        clearRevealsVersion={clearRevealsVersion}
        onSnapshot={onSnapshot}
        onDraftChange={setTotpDraft}
        onBusyChange={setTotpBusy}
      />
      <EntryNotesSection
        api={api}
        detail={detail}
        disabled={disabled}
        clearRevealsVersion={clearRevealsVersion}
        copying={clipboard.copying === "notes"}
        copyDisabled={clipboard.copying !== null}
        onCopy={() => void clipboard.copy("notes")}
      />
      <EntryCustomIconSection
        api={api}
        entryId={detail.id}
        icon={detail.icon}
        disabled={disabled}
        mutationDisabled={mutationDisabled || recycled}
        onSnapshot={onSnapshot}
        onBusyChange={setIconBusy}
      />
      <EntryExpiryStatus expiresAtUnixSeconds={detail.expiresAtUnixSeconds} />
      <EntryHistorySection
        api={api}
        entryId={detail.id}
        disabled={disabled || mutationDisabled || recycled}
        onSnapshot={onSnapshot}
        onDraftChange={setHistoryDraft}
        onBusyChange={setHistoryBusy}
      />
      <CustomFieldsEditor
        api={api}
        entryId={detail.id}
        fields={detail.customFields}
        disabled={disabled || mutationDisabled || recycled}
        onApplied={onSnapshot}
        onDraftChange={setCustomFieldDraft}
        onBusyChange={setCustomFieldBusy}
      />
      <EntryAttachmentsSection
        api={api}
        entryId={detail.id}
        disabled={disabled}
        mutationDisabled={mutationDisabled || recycled}
        onSnapshot={onSnapshot}
        onBusyChange={setAttachmentBusy}
      />
      <EntryActions
        api={api}
        detail={detail}
        groups={groups}
        disabled={disabled || mutationDisabled}
        recycled={recycled}
        recycleBinEnabled={recycleBinEnabled}
        onDeleted={onDeleted}
        onDuplicated={onDuplicated}
        onMoved={onMoved}
        onDraftChange={setEntryActionDraft}
        onBusyChange={setEntryActionBusy}
      />
      <p className="copy-status" aria-live="polite">
        {clipboard.status ?? ""}
      </p>
    </>
  );
}
