import type { DesktopApi } from "./desktop-api-types";
import { parseClipboardReceipt } from "./entry-validation";

type DesktopCall = <T>(
  command: string,
  parse: (value: unknown) => T,
  args?: Record<string, unknown>,
) => Promise<T>;

type ClipboardApi = Pick<
  DesktopApi,
  | "copyGeneratedPassword"
  | "copyEntryCustomField"
  | "copyEntryNotes"
  | "copyEntryPassword"
  | "copyEntryTitle"
  | "copyEntryTotp"
  | "copyEntryUrl"
  | "copyEntryUsername"
>;

export function createClipboardApi(call: DesktopCall): ClipboardApi {
  return {
    copyGeneratedPassword: (password) =>
      call("copy_generated_password", parseClipboardReceipt, { password }),
    copyEntryCustomField: (entryId, name) =>
      call("copy_entry_custom_field", parseClipboardReceipt, { entryId, name }),
    copyEntryTitle: (entryId) =>
      call("copy_entry_title", parseClipboardReceipt, { entryId }),
    copyEntryUsername: (entryId) =>
      call("copy_entry_username", parseClipboardReceipt, { entryId }),
    copyEntryUrl: (entryId) =>
      call("copy_entry_url", parseClipboardReceipt, { entryId }),
    copyEntryNotes: (entryId) =>
      call("copy_entry_notes", parseClipboardReceipt, { entryId }),
    copyEntryPassword: (entryId) =>
      call("copy_entry_password", parseClipboardReceipt, { entryId }),
    copyEntryTotp: (entryId) =>
      call("copy_entry_totp_code", parseClipboardReceipt, { entryId }),
  };
}
