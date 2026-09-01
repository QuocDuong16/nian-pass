import { useEffect, useState, type ReactNode } from "react";

import type { BrowserApprovalApi } from "../../lib/browser-approval";

interface BrowserConnectionApprovalProps {
  api: BrowserApprovalApi | null;
  children: ReactNode;
}

const UI_TIMEOUT_MS = 61_000;

export function BrowserConnectionApproval({
  api,
  children,
}: BrowserConnectionApprovalProps) {
  const [requests, setRequests] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const requestId = requests[0] ?? null;

  useEffect(() => {
    if (api === null) return;
    let active = true;
    let unlisten: (() => void) | null = null;
    void api
      .subscribe((nextRequestId) => {
        if (!active) return;
        setRequests((current) =>
          current.includes(nextRequestId)
            ? current
            : [...current, nextRequestId],
        );
      })
      .then((stop) => {
        if (active) unlisten = stop;
        else stop();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      unlisten?.();
    };
  }, [api]);

  useEffect(() => {
    if (requestId === null) return;
    const timer = window.setTimeout(() => {
      setRequests((current) => current.filter((value) => value !== requestId));
    }, UI_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [requestId]);

  const resolve = (allow: boolean) => {
    if (api === null || requestId === null) return;
    setError(null);
    void api
      .resolve(requestId, allow)
      .catch(() => {
        setError("This browser connection request is no longer available.");
      })
      .finally(() => {
        setRequests((current) =>
          current.filter((value) => value !== requestId),
        );
      });
  };

  return (
    <>
      <div hidden={requestId !== null} aria-hidden={requestId !== null}>
        {children}
      </div>
      {requestId === null ? null : (
        <div className="modal-backdrop browser-approval-backdrop">
          <section
            className="modal-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="browser-approval-title"
          >
            <h2 id="browser-approval-title">
              Browser integration connection request
            </h2>
            <p>
              Allow this new browser integration connection for its current
              session?
            </p>
            {error === null ? null : <p role="alert">{error}</p>}
            <div className="dialog-actions">
              <button
                type="button"
                onClick={() => {
                  resolve(false);
                }}
              >
                Deny
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={() => {
                  resolve(true);
                }}
              >
                Allow
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
