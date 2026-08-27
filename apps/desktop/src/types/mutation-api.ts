import type { DesktopApi } from "../lib/desktop";

export type CustomFieldEditorApi = Pick<
  DesktopApi,
  "revealEntryCustomField" | "setEntryCustomField" | "deleteEntryCustomField"
>;
