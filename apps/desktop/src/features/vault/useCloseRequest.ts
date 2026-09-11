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
        try {
          const before = latest.current;
          if (before.blocked) return;
          if (before.hasLocalDraft) {
            if (active) before.onDraft();
            return;
          }
          const policy = await before.api.closePolicy();
          if (!active) return;

          const after = latest.current;
          if (after.blocked) return;
          if (after.hasLocalDraft) {
            after.onDraft();
            return;
          }
          if (policy.policy === "confirm_discard") {
            after.onDirty();
            return;
          }
          await after.windowLifecycle?.destroyApprovedWindow();
        } catch {
          if (active) latest.current.onError();
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
