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
  const closePolicyInFlight = useRef(false);
  useEffect(() => {
    latest.current = options;
  }, [options]);

  useEffect(() => {
    if (options.windowLifecycle === null) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    void options.windowLifecycle
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (closePolicyInFlight.current) return;
        closePolicyInFlight.current = true;
        const current = latest.current;
        try {
          if (current.blocked) return;
          if (current.hasLocalDraft) {
            if (active) current.onDraft();
            return;
          }
          const policy = await current.api.closePolicy();
          if (policy.policy === "confirm_discard") {
            if (active) current.onDirty();
          } else if (active && current.windowLifecycle !== null) {
            await current.windowLifecycle.destroyApprovedWindow();
          }
        } catch {
          if (active) current.onError();
        } finally {
          closePolicyInFlight.current = false;
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
