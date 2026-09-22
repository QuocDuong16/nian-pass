import { useState } from "react";

import type { DesktopApi } from "../../lib/desktop";
import type { VaultSnapshotDto } from "../../types/desktop";

const MAX_BULK_ENTRY_COUNT = 1024;

interface UseBulkEntryActionsOptions {
  api: DesktopApi;
  availableEntryIds: string[];
  onBusyChange: (busy: boolean) => void;
  onChanged: (snapshot: VaultSnapshotDto, destinationGroupId?: string) => void;
  onSelectionStart: () => void;
}

export function useBulkEntryActions(options: UseBulkEntryActionsOptions) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [dialog, setDialog] = useState<
    "move" | "trash" | "restore" | "delete" | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setSelectionMode(false);
    setSelectedEntryIds(new Set());
    setDialog(null);
    setError(null);
  };

  const start = () => {
    options.onSelectionStart();
    setSelectedEntryIds(new Set());
    setError(null);
    setSelectionMode(true);
  };

  const toggle = (entryId: string) => {
    setError(null);
    setSelectedEntryIds((current) => {
      const next = new Set(current);
      if (next.has(entryId)) {
        next.delete(entryId);
        return next;
      }
      if (next.size >= MAX_BULK_ENTRY_COUNT) {
        setError(`Select at most ${String(MAX_BULK_ENTRY_COUNT)} entries.`);
        return current;
      }
      next.add(entryId);
      return next;
    });
  };

  const selectAll = () => {
    if (options.availableEntryIds.length > MAX_BULK_ENTRY_COUNT) {
      setError(
        `Select entries manually; one bulk operation is limited to ${String(MAX_BULK_ENTRY_COUNT)} entries.`,
      );
      return;
    }
    setError(null);
    setSelectedEntryIds(new Set(options.availableEntryIds));
  };

  const run = async (
    action: () => Promise<VaultSnapshotDto>,
    destinationGroupId?: string,
  ) => {
    if (selectedEntryIds.size === 0 || busy) return;
    setBusy(true);
    setError(null);
    options.onBusyChange(true);
    try {
      const snapshot = await action();
      reset();
      options.onChanged(snapshot, destinationGroupId);
    } catch {
      setError("The bulk operation failed. No partial result was accepted.");
    } finally {
      setBusy(false);
      options.onBusyChange(false);
    }
  };

  const confirmMove = (destinationGroupId: string) => {
    const ids = [...selectedEntryIds];
    void run(
      () => options.api.moveEntries(ids, destinationGroupId),
      destinationGroupId,
    );
  };

  const confirmTrash = () => {
    const ids = [...selectedEntryIds];
    void run(() => options.api.trashEntries(ids));
  };

  const confirmRestore = () => {
    const ids = [...selectedEntryIds];
    void run(() => options.api.restoreEntries(ids));
  };

  const confirmPermanentDelete = () => {
    const ids = [...selectedEntryIds];
    void run(() => options.api.permanentlyDeleteEntries(ids));
  };

  return {
    selectionMode,
    selectedEntryIds,
    selectedCount: selectedEntryIds.size,
    dialog,
    busy,
    error,
    start,
    cancel: reset,
    toggle,
    selectAll,
    openMove: () => {
      if (selectedEntryIds.size > 0) setDialog("move");
    },
    openTrash: () => {
      if (selectedEntryIds.size > 0) setDialog("trash");
    },
    openRestore: () => {
      if (selectedEntryIds.size > 0) setDialog("restore");
    },
    openPermanentDelete: () => {
      if (selectedEntryIds.size > 0) setDialog("delete");
    },
    closeDialog: () => {
      if (!busy) {
        setDialog(null);
        setError(null);
      }
    },
    confirmMove,
    confirmTrash,
    confirmRestore,
    confirmPermanentDelete,
  };
}
