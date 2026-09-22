import { useEffect, useRef, useState } from "react";

import { Button } from "../../components/Button";
import type { DesktopApi } from "../../lib/desktop";
import { PasswordGenerator } from "./PasswordGenerator";

interface QuickPasswordGeneratorProps {
  api: DesktopApi;
  disabled: boolean;
  privacyVersion: number;
  onClose: () => void;
}

/** Ephemeral standalone generator; no entry draft or vault mutation is created. */
export function QuickPasswordGenerator({
  api,
  disabled,
  privacyVersion,
  onClose,
}: QuickPasswordGeneratorProps) {
  const [generated, setGenerated] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [copying, setCopying] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const generation = useRef(0);
  const initialPrivacyVersion = useRef(privacyVersion);

  useEffect(() => {
    const closeOnBlur = () => {
      generation.current += 1;
      onClose();
    };
    const closeWhenHidden = () => {
      if (document.visibilityState === "hidden") closeOnBlur();
    };
    window.addEventListener("blur", closeOnBlur);
    document.addEventListener("visibilitychange", closeWhenHidden);
    return () => {
      generation.current += 1;
      window.removeEventListener("blur", closeOnBlur);
      document.removeEventListener("visibilitychange", closeWhenHidden);
    };
  }, [onClose]);

  useEffect(() => {
    if (initialPrivacyVersion.current !== privacyVersion || disabled) {
      generation.current += 1;
      onClose();
    }
  }, [privacyVersion, disabled, onClose]);

  const copy = async () => {
    if (disabled || copying || generated === null) return;
    const current = generation.current;
    setCopying(true);
    setStatus(null);
    try {
      const receipt = await api.copyGeneratedPassword(generated);
      if (current === generation.current) {
        setStatus(
          `Copied. Clipboard clears in ${String(receipt.expiresInMs / 1000)}s if unchanged.`,
        );
      }
    } catch {
      if (current === generation.current) {
        setStatus("Could not copy to the clipboard.");
      }
    } finally {
      if (current === generation.current) setCopying(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <section
        className="modal-panel quick-generator-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-generator-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !copying) {
            event.preventDefault();
            onClose();
          }
        }}
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Offline · no vault changes</p>
            <h2 id="quick-generator-title">Password generator</h2>
          </div>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            disabled={copying}
            onClick={onClose}
          >
            Close
          </Button>
        </div>
        <p className="field-hint">
          Generate a password or passphrase without creating an entry. The value
          stays here until this window closes or the app loses focus.
        </p>
        <PasswordGenerator
          disabled={disabled || copying}
          onGenerated={(value) => {
            generation.current += 1;
            setGenerated(value);
            setRevealed(false);
            setStatus(null);
          }}
        />
        {generated === null ? (
          <p className="field-hint" role="status">
            Nothing generated yet.
          </p>
        ) : (
          <div className="quick-generator-result">
            <label htmlFor="quick-generated-value">Generated value</label>
            <input
              id="quick-generated-value"
              type={revealed ? "text" : "password"}
              readOnly
              autoComplete="off"
              spellCheck={false}
              value={generated}
            />
            <div className="dialog-actions">
              <Button
                size="sm"
                variant="secondary"
                type="button"
                disabled={disabled || copying}
                onClick={() => {
                  setRevealed((current) => !current);
                }}
              >
                {revealed ? "Hide value" : "Show value"}
              </Button>
              <Button
                size="sm"
                type="button"
                disabled={disabled || copying}
                onClick={() => void copy()}
              >
                {copying ? "Copying…" : "Copy generated value"}
              </Button>
            </div>
          </div>
        )}
        {status === null ? null : (
          <p className="field-hint" role="status">
            {status}
          </p>
        )}
      </section>
    </div>
  );
}
