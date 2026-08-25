import { useEffect } from "react";

export function useSecurityFormTelemetry(
  hasDraft: boolean,
  busy: boolean,
  onDraftChange?: (active: boolean) => void,
  onBusyChange?: (busy: boolean) => void,
) {
  useEffect(() => {
    onDraftChange?.(hasDraft);
    return () => {
      onDraftChange?.(false);
    };
  }, [hasDraft, onDraftChange]);

  useEffect(() => {
    onBusyChange?.(busy);
    return () => {
      onBusyChange?.(false);
    };
  }, [busy, onBusyChange]);
}
