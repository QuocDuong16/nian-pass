import { useEffect, useState } from "react";

import type { MobileApi, MobileAutofillStatusDto } from "../../types/mobile";

export function MobileAutofillSettings({ api }: { api: MobileApi }) {
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

  return (
    <section className="mobile-autofill-settings" aria-label="Android Autofill">
      <h2>Android Autofill</h2>
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
        {status?.sourceEnabled === true
          ? "Disable Autofill for this vault"
          : "Enable Autofill for this vault"}
      </button>
      <button
        className="secondary-button"
        type="button"
        disabled={busy}
        onClick={() => void api.openAutofillSettings()}
      >
        Open Android provider settings
      </button>
      {error === null ? null : (
        <p className="shell-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
