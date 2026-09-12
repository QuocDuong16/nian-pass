import { useCallback, useEffect, useState } from "react";

import type { MobileVaultSnapshotDto } from "../../types/mobile";
import type {
  MobileApi,
  MobileAutofillRequestDto,
  MobileSelectedVaultDto,
} from "../../types/mobile";

interface Options {
  api: MobileApi;
  enabled: boolean;
  onSelected: (selected: MobileSelectedVaultDto) => void;
  onUnlocked: (snapshot: MobileVaultSnapshotDto) => void;
}

export function useMobileAutofillLaunch({
  api,
  enabled,
  onSelected,
  onUnlocked,
}: Options) {
  const [request, setRequest] = useState<MobileAutofillRequestDto | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    void api
      .getAutofillRequest()
      .then((launch) => {
        if (!active || launch === null) return;
        setRequest(launch.request);
        if (launch.selectedVault !== null) {
          onSelected(launch.selectedVault);
          return;
        }
        return api
          .getVaultSnapshot()
          .then((snapshot) => {
            if (active) onUnlocked(snapshot);
          })
          .catch(() => {
            // A locked provider without a remembered source remains valid.
          });
      })
      .catch(() => {
        // Normal launcher starts have no Android credential request.
      });
    return () => {
      active = false;
    };
  }, [api, enabled, onSelected, onUnlocked]);

  const clearRequest = useCallback(() => {
    setRequest(null);
  }, []);
  return { request, clearRequest };
}
