import { useEffect } from "react";

interface SaveShortcutOptions {
  blocked: boolean;
  settingsOpen: boolean;
  onSave: () => void;
}

export function useSaveShortcut({
  blocked,
  settingsOpen,
  onSave,
}: SaveShortcutOptions) {
  useEffect(() => {
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if (
        event.key.toLocaleLowerCase() !== "s" ||
        (!event.ctrlKey && !event.metaKey)
      )
        return;
      event.preventDefault();
      if (!blocked && !settingsOpen) onSave();
    };
    window.addEventListener("keydown", handleSaveShortcut);
    return () => {
      window.removeEventListener("keydown", handleSaveShortcut);
    };
  }, [blocked, onSave, settingsOpen]);
}
