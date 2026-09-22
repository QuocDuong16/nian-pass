import { useEffect, useState } from "react";

import type { DesktopApi } from "../../lib/desktop";

/** Unknown or failed keyfile status never authorizes passwordless sync. */
export function useSyncKeyfileStatus(
  api: DesktopApi,
  onFailure: (message: string) => void,
): boolean | null {
  const [hasKeyfile, setHasKeyfile] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void api.credentialHasKeyfile().then(
      (present) => {
        if (active) setHasKeyfile(present);
      },
      () => {
        if (active) {
          setHasKeyfile(null);
          onFailure("Could not check the active keyfile for synchronization.");
        }
      },
    );
    return () => {
      active = false;
    };
  }, [api, onFailure]);
  return hasKeyfile;
}
