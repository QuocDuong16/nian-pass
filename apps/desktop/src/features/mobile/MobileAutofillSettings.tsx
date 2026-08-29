import { useEffect, useState } from "react";

import type { MobileApi, MobileAutofillStatusDto } from "../../types/mobile";
import type { RuntimePlatform } from "../../types/runtime";

export function MobileAutofillSettings({
  api,
  platform,
}: {
  api: MobileApi;
  platform: Extract<RuntimePlatform, "android" | "ios">;
}) {
  const [status, setStatus] = useState<MobileAutofillStatusDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .getAutofillStatus()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch(() => {
        if (active) setError("Autofill status is unavailable.");
      });
    return () => {
      active = false;
    };
  }, [api]);

  const toggle = async () => {
    if (busy || status === null) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(
        status.sourceEnabled
          ? await api.disableAutofill()
          : await api.enableAutofill(),
      );
    } catch {
      setError("Nian Pass could not change Autofill source access.");
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(await api.refreshAutofill());
    } catch {
      setError("Nian Pass could not refresh the encrypted AutoFill mirror.");
    } finally {
      setBusy(false);
    }
  };

  const label = platform === "ios" ? "Password AutoFill" : "Android Autofill";
  const toggleLabel =
    platform === "ios"
      ? status?.sourceEnabled === true
        ? "Disable Password AutoFill"
        : "Enable Password AutoFill"
      : status?.sourceEnabled === true
        ? "Disable Autofill for this vault"
        : "Enable Autofill for this vault";

  return (
    <section className="mobile-autofill-settings" aria-label={label}>
      <h2>{label}</h2>
      <p>
        Autofill source:{" "}
        {status?.sourceEnabled === true ? "Enabled" : "Disabled"}
      </p>
      <button
        className="secondary-button"
        type="button"
        disabled={busy || status === null}
        onClick={() => void toggle()}
      >
        {toggleLabel}
      </button>
      {platform === "ios" && status?.sourceEnabled === true ? (
        <button
          className="secondary-button"
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
        >
          Refresh encrypted mirror
        </button>
      ) : null}
      <button
        className="secondary-button"
        type="button"
        disabled={busy}
        onClick={() => void api.openAutofillSettings()}
      >
        Open {platform === "ios" ? "iOS AutoFill" : "Android provider"} settings
      </button>
      {error === null ? null : (
        <p className="shell-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
