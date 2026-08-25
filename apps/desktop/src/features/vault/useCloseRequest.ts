import { useEffect, useRef } from "react";

import type { DesktopApi } from "../../lib/desktop";
import type { DesktopWindowLifecycle } from "../../lib/window-lifecycle";

interface CloseRequestOptions {
  api: DesktopApi;
  windowLifecycle: DesktopWindowLifecycle | null;
  blocked: boolean;
  hasLocalDraft: boolean;
  onDraft: () => void;
  onDirty: () => void;
  onError: () => void;
}

export function useCloseRequest(options: CloseRequestOptions) {
  const latest = useRef(options);
  useEffect(() => {
    latest.current = options;
  }, [options]);

  useEffect(() => {
    if (options.windowLifecycle === null) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    void options.windowLifecycle
      .onCloseRequested(async (event) => {
        const current = latest.current;
        if (current.blocked) {
          event.preventDefault();
          return;
        }
        if (current.hasLocalDraft) {
          event.preventDefault();
          if (active) current.onDraft();
          return;
        }
        try {
          const policy = await current.api.closePolicy();
          if (policy.policy === "confirm_discard") {
            event.preventDefault();
            if (active) current.onDirty();
          }
        } catch {
          event.preventDefault();
          if (active) current.onError();
        }
      })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [options.windowLifecycle]);
}
