import { useCallback, useState } from "react";

import type { DesktopApi } from "../../lib/desktop";
import type { SummaryTextDto } from "../../types/desktop";

interface Options {
  api: DesktopApi;
  entryId: string;
  url: SummaryTextDto;
  disabled: boolean;
}

export function useEntryUrlOpen({ api, entryId, url, disabled }: Options) {
  const [opening, setOpening] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const open = useCallback(async () => {
    if (disabled || opening || url.kind !== "visible" || url.value === "")
      return;
    setOpening(true);
    setStatus(null);
    try {
      await api.openEntryUrl(entryId);
      setStatus("Opened in the default browser.");
    } catch {
      setStatus("Could not open this URL.");
    } finally {
      setOpening(false);
    }
  }, [api, disabled, entryId, opening, url]);

  return { opening, status, open };
}
