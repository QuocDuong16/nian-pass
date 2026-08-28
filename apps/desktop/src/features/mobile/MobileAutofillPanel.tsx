import { useEffect, useState } from "react";

import type { SummaryTextDto } from "../../types/desktop";
import type {
  AutofillCandidateDto,
  MobileApi,
  MobileAutofillRequestDto,
} from "../../types/mobile";

interface Props {
  api: MobileApi;
  request: MobileAutofillRequestDto;
}

function label(value: SummaryTextDto, fallback: string) {
  return value.kind === "visible" && value.value !== ""
    ? value.value
    : fallback;
}

export function MobileAutofillPanel({ api, request }: Props) {
  const [candidates, setCandidates] = useState<AutofillCandidateDto[] | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .getAutofillCandidates(request.requestToken)
      .then((next) => {
        if (!active) return;
        setCandidates(next);
        if (request.kind === "credential_query" && next.length > 0) {
          setBusy(true);
          return api
            .publishAutofillCandidates(request.requestToken)
            .then(() => {
              if (active) setCompleted(true);
            });
        }
      })
      .catch(() => {
        if (active) setError("Credentials are unavailable for this request.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [api, request.kind, request.requestToken]);

  const visibleCandidates =
    candidates?.filter(
      (candidate) =>
        request.selectedEntryId === null ||
        candidate.entryId === request.selectedEntryId,
    ) ?? null;

  const fill = async (candidate: AutofillCandidateDto) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.approveAutofill(
        request.requestToken,
        candidate.entryId,
        request.requiresConfirmation,
      );
      setCompleted(true);
      setCandidates([]);
    } catch {
      setError("Nian Pass did not release a credential.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.cancelAutofill(request.requestToken);
      setCandidates([]);
      setCompleted(true);
    } catch {
      setError("Could not cancel the Android credential request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="locked-view mobile-locked-view">
      <section className="unlock-card" aria-labelledby="autofill-title">
        <div className="brand-mark" aria-hidden="true">
          N
        </div>
        <p className="eyebrow">Android credential request</p>
        <h1 id="autofill-title">Fill credentials for:</h1>
        <p className="selected-file">{request.targetDisplay}</p>
        {request.requiresConfirmation ? (
          <p className="form-error" role="status">
            Nian Pass could not verify this target association. Confirm before
            releasing a credential.
          </p>
        ) : null}
        {error === null ? null : (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {completed ? <p role="status">Returning to Android…</p> : null}
        {visibleCandidates === null ? <p role="status">Matching…</p> : null}
        {visibleCandidates?.length === 0 && !completed ? (
          <p role="status">No matching credentials.</p>
        ) : null}
        {request.kind === "credential_query"
          ? null
          : visibleCandidates?.map((candidate) => (
              <button
                className="primary-button file-button"
                type="button"
                key={candidate.entryId}
                disabled={busy}
                onClick={() => void fill(candidate)}
              >
                {label(candidate.title, "Protected account")}
                {" · "}
                {label(candidate.username, "Username protected")}
              </button>
            ))}
        <button
          className="secondary-button file-button choose-another"
          type="button"
          disabled={busy || completed}
          onClick={() => void cancel()}
        >
          Cancel
        </button>
      </section>
    </main>
  );
}
