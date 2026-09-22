import type { EntryIconDto, UpdateEntryRequest } from "../../types/desktop";

export const STANDARD_ENTRY_ICONS = [
  [0, "Password / key"],
  [1, "Network"],
  [2, "Warning"],
  [3, "Server"],
  [4, "Clipboard / pinned note"],
  [5, "Language / communication"],
  [6, "Packages"],
  [7, "Text editor"],
  [8, "Network socket"],
  [9, "Identity"],
  [10, "Address book"],
  [11, "Camera / pictures"],
  [12, "Wireless network"],
  [13, "Key ring"],
  [14, "Power / energy"],
  [15, "Scanner"],
  [16, "Bookmark"],
  [17, "Optical media"],
  [18, "Display"],
  [19, "Mail"],
  [20, "Settings / gears"],
  [21, "Checklist"],
  [22, "Document"],
  [23, "Desktop computer"],
  [24, "Remote connection"],
  [25, "Inbox"],
  [26, "Save / disk"],
  [27, "Remote storage"],
  [28, "Media files"],
  [29, "Secure shell"],
  [30, "Terminal"],
  [31, "Printer"],
  [32, "Disk usage"],
  [33, "Launch application"],
  [34, "Tools / wrench"],
  [35, "Internet computer"],
  [36, "Compressed archive"],
  [37, "Percentage"],
  [38, "File share"],
  [39, "Time"],
  [40, "Search"],
  [41, "Vector graphics"],
  [42, "Memory hardware"],
  [43, "Recycle bin"],
  [44, "Sticky note"],
  [45, "Cancel / error"],
  [46, "Help"],
  [47, "Software package"],
  [48, "Closed folder"],
  [49, "Open folder"],
  [50, "TAR archive"],
  [51, "Decryption"],
  [52, "Encryption"],
  [53, "Approved / OK"],
  [54, "Signature"],
  [55, "Image preview"],
  [56, "Contacts"],
  [57, "Table / database"],
  [58, "Private key"],
  [59, "Development"],
  [60, "Home folder"],
  [61, "Favorite / star"],
  [62, "Linux"],
  [63, "Web server"],
  [64, "macOS"],
  [65, "Wiki"],
  [66, "Finance"],
  [67, "Certificate"],
  [68, "Mobile device"],
] as const;

export type EntryIconSelection = "preserve" | "none" | `built_in:${number}`;

export function entryIconLabel(icon: EntryIconDto): string {
  switch (icon.kind) {
    case "none":
      return "No explicit icon";
    case "custom":
      return "Custom icon";
    case "non_standard":
      return "Non-standard built-in icon";
    case "built_in":
      return (
        STANDARD_ENTRY_ICONS.find(([id]) => id === icon.id)?.[1] ??
        `Standard icon ${String(icon.id)}`
      );
  }
}

export function entryIconSelection(icon: EntryIconDto): EntryIconSelection {
  switch (icon.kind) {
    case "none":
      return "none";
    case "built_in":
      return `built_in:${String(icon.id)}` as EntryIconSelection;
    case "custom":
    case "non_standard":
      return "preserve";
  }
}

export function iconRequestFromSelection(
  selection: EntryIconSelection,
): UpdateEntryRequest["icon"] | undefined {
  if (selection === "preserve") return undefined;
  if (selection === "none") return { kind: "none" };
  const id = Number(selection.slice("built_in:".length));
  const exists = STANDARD_ENTRY_ICONS.some(([candidate]) => candidate === id);
  return exists ? { kind: "built_in", id } : undefined;
}
