import { useEffect, useState } from "react";

import type { DesktopApi } from "../../lib/desktop";

export type EntryClipboardTarget =
  "title" | "username" | "url" | "notes" | "password";

interface UseEntryClipboardOptions {
  api: DesktopApi;
  entryId: string;
  disabled: boolean;
}

function copyForTarget(
  api: DesktopApi,
  entryId: string,
  target: EntryClipboardTarget,
) {
  switch (target) {
    case "notes":
      return api.copyEntryNotes(entryId);
    case "password":
      return api.copyEntryPassword(entryId);
    case "title":
      return api.copyEntryTitle(entryId);
    case "url":
      return api.copyEntryUrl(entryId);
    case "username":
      return api.copyEntryUsername(entryId);
  }
}

export function useEntryClipboard({
  api,
  entryId,
  disabled,
}: UseEntryClipboardOptions) {
  const [copying, setCopying] = useState<EntryClipboardTarget | null>(null);
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

  const copy = async (target: EntryClipboardTarget) => {
    if (disabled || copying !== null) return;
    setCopying(target);
    setStatus(null);
    try {
      const receipt = await copyForTarget(api, entryId, target);
      setStatus(
        `Copied. Clipboard clears in ${String(receipt.expiresInMs / 1000)}s if unchanged.`,
      );
    } catch {
      setStatus("Could not copy to the clipboard.");
    } finally {
      setCopying(null);
    }
  };

  return { copying, status, copy };
}
