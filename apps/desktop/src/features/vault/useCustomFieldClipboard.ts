import { useEffect, useState } from "react";

import type { EntryId } from "../../types/desktop";
import type { CustomFieldEditorApi } from "../../types/mutation-api";

type CopyEntryCustomField = NonNullable<
  CustomFieldEditorApi["copyEntryCustomField"]
>;

interface UseCustomFieldClipboardOptions {
  copyEntryCustomField: CopyEntryCustomField | undefined;
  entryId: EntryId;
  disabled: boolean;
}

export function useCustomFieldClipboard({
  copyEntryCustomField,
  entryId,
  disabled,
}: UseCustomFieldClipboardOptions) {
  const [copyingFieldName, setCopyingFieldName] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (status === null) return;
    const timer = setTimeout(() => {
      setStatus(null);
    }, 4_000);
    return () => {
      clearTimeout(timer);
    };
  }, [status]);

  const copy = async (name: string) => {
    if (
      disabled ||
      copyEntryCustomField === undefined ||
      copyingFieldName !== null
    ) {
      return;
    }
    setCopyingFieldName(name);
    setStatus(null);
    try {
      const receipt = await copyEntryCustomField(entryId, name);
      setStatus(
        `Copied. Clipboard clears in ${String(receipt.expiresInMs / 1000)}s if unchanged.`,
      );
    } catch {
      setStatus("Could not copy to the clipboard.");
    } finally {
      setCopyingFieldName(null);
    }
  };

  return {
    available: copyEntryCustomField !== undefined,
    copyingFieldName,
    status,
    copy,
  };
}
