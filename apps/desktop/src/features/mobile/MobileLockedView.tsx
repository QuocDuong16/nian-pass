import type { SyntheticEvent } from "react";

import type { MobileSelectedVaultDto } from "../../types/mobile";

interface MobileLockedViewProps {
  selected: MobileSelectedVaultDto | null;
  password: string;
  busy: boolean;
  unlocking: boolean;
  error: string | null;
  onPassword: (value: string) => void;
  onChoose: () => void;
  onUnlock: () => void;
}

export function MobileLockedView({
  selected,
  password,
  busy,
  unlocking,
  error,
  onPassword,
  onChoose,
  onUnlock,
}: MobileLockedViewProps) {
  const submit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    onUnlock();
  };

  return (
    <main className="locked-view mobile-locked-view">
      <section className="unlock-card" aria-labelledby="mobile-title">
        <div className="brand-mark" aria-hidden="true">
          N
        </div>
        <p className="eyebrow">
          Android ·{" "}
          {selected?.writable === true ? "Explicit Save" : "Read only"}
        </p>
        <h1 id="mobile-title">Nian Pass</h1>
        {selected === null ? (
          <button
            className="primary-button file-button"
            type="button"
            disabled={busy}
            onClick={onChoose}
          >
            {busy ? "Opening…" : "Open KDBX"}
          </button>
        ) : (
          <>
            <p className="selected-file">{selected.fileName}</p>
            <form onSubmit={submit}>
              <label htmlFor="mobile-password">Master password</label>
              <input
                id="mobile-password"
                type="password"
                autoComplete="current-password"
                value={password}
                disabled={busy}
                onChange={(event) => {
                  onPassword(event.target.value);
                }}
              />
              <button
                className="primary-button unlock-button"
                type="submit"
                disabled={busy || password.length === 0}
              >
                {unlocking ? "Unlocking…" : "Unlock"}
              </button>
            </form>
            <button
              className="secondary-button file-button choose-another"
              type="button"
              disabled={busy}
              onClick={onChoose}
            >
              Choose another vault
            </button>
          </>
        )}
        {error === null ? null : (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
