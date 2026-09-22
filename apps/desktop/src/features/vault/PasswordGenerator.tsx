import { useMemo, useState } from "react";

import {
  generatePassphrase,
  MAX_PASSPHRASE_WORDS,
  MIN_PASSPHRASE_WORDS,
  PASSPHRASE_WORD_COUNT,
  type PassphraseOptions,
} from "./passphrase-generation";
import {
  generatePassword,
  hasValidPasswordOptions,
  type GeneratorOptions,
} from "./password-generation";

interface PasswordGeneratorProps {
  disabled?: boolean;
  onGenerated: (password: string) => void;
}

export function PasswordGenerator({
  disabled = false,
  onGenerated,
}: PasswordGeneratorProps) {
  const [open, setOpen] = useState(false);
  const [generationFailed, setGenerationFailed] = useState(false);
  const [mode, setMode] = useState<"characters" | "passphrase">("characters");
  const [options, setOptions] = useState<GeneratorOptions>({
    length: 24,
    uppercase: true,
    lowercase: true,
    digits: true,
    symbols: true,
    avoidAmbiguous: true,
  });
  const [phraseOptions, setPhraseOptions] = useState<PassphraseOptions>({
    words: 6,
    separator: "-",
    capitalize: false,
  });
  const charactersValid = hasValidPasswordOptions(options);
  const phraseValid =
    Number.isSafeInteger(phraseOptions.words) &&
    phraseOptions.words >= MIN_PASSPHRASE_WORDS &&
    phraseOptions.words <= MAX_PASSPHRASE_WORDS;
  const valid = mode === "characters" ? charactersValid : phraseValid;
  const quality = useMemo(() => {
    const sets = [
      options.uppercase,
      options.lowercase,
      options.digits,
      options.symbols,
    ].filter(Boolean).length;
    if (options.length >= 20 && sets >= 3) return "Strong";
    if (options.length >= 14 && sets >= 2) return "Good";
    return "Basic";
  }, [options]);

  const update = <K extends keyof GeneratorOptions>(
    key: K,
    value: GeneratorOptions[K],
  ) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="password-generator">
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        Generate password
      </button>
      {open ? (
        <div className="generator-panel">
          <div
            className="generator-mode"
            role="group"
            aria-label="Generator mode"
          >
            <button
              type="button"
              aria-pressed={mode === "characters"}
              disabled={disabled}
              onClick={() => {
                setMode("characters");
              }}
            >
              Characters
            </button>
            <button
              type="button"
              aria-pressed={mode === "passphrase"}
              disabled={disabled}
              onClick={() => {
                setMode("passphrase");
              }}
            >
              Passphrase
            </button>
          </div>
          {mode === "characters" ? (
            <>
              <label className="generator-wide">
                Length
                <input
                  type="number"
                  min={8}
                  max={128}
                  value={options.length}
                  disabled={disabled}
                  onChange={(event) => {
                    update("length", Number(event.currentTarget.value));
                  }}
                />
              </label>
              {(
                [
                  ["uppercase", "Uppercase"],
                  ["lowercase", "Lowercase"],
                  ["digits", "Digits"],
                  ["symbols", "Symbols"],
                ] as const
              ).map(([key, label]) => (
                <label className="checkbox-row" key={key}>
                  <input
                    type="checkbox"
                    checked={options[key]}
                    disabled={disabled}
                    onChange={(event) => {
                      update(key, event.currentTarget.checked);
                    }}
                  />
                  {label}
                </label>
              ))}
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={options.avoidAmbiguous}
                  disabled={disabled}
                  onChange={(event) => {
                    update("avoidAmbiguous", event.currentTarget.checked);
                  }}
                />
                Avoid ambiguous characters
              </label>
            </>
          ) : (
            <>
              <label className="generator-wide">
                Words
                <input
                  type="number"
                  min={MIN_PASSPHRASE_WORDS}
                  max={MAX_PASSPHRASE_WORDS}
                  step={1}
                  value={phraseOptions.words}
                  disabled={disabled}
                  onChange={(event) => {
                    const words = Number(event.currentTarget.value);
                    setPhraseOptions((current) => ({
                      ...current,
                      words,
                    }));
                  }}
                />
              </label>
              <label>
                Separator
                <select
                  value={phraseOptions.separator}
                  disabled={disabled}
                  onChange={(event) => {
                    const separator =
                      event.currentTarget.value === " " ? " " : "-";
                    setPhraseOptions((current) => ({
                      ...current,
                      separator,
                    }));
                  }}
                >
                  <option value="-">Hyphen</option>
                  <option value=" ">Space</option>
                </select>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={phraseOptions.capitalize}
                  disabled={disabled}
                  onChange={(event) => {
                    const capitalize = event.currentTarget.checked;
                    setPhraseOptions((current) => ({
                      ...current,
                      capitalize,
                    }));
                  }}
                />
                Capitalize words
              </label>
              <small className="generator-wide">
                {PASSPHRASE_WORD_COUNT.toLocaleString("en-US")}-word EFF-based
                list, bundled offline. Six or more independently random words.
                Wordlist by Joseph Bonneau and EFF (CC BY 3.0 US), adapted by
                KeePassXC.
              </small>
            </>
          )}
          {generationFailed ? (
            <small className="generator-wide" role="alert">
              Secure random generation failed. No password was generated.
            </small>
          ) : null}
          <div className="generator-footer">
            <span>
              {mode === "characters"
                ? `Password quality: ${quality}`
                : `Random word choices: ${String(phraseOptions.words)} words`}
            </span>
            <button
              type="button"
              disabled={disabled || !valid}
              onClick={() => {
                let generated: string;
                try {
                  generated =
                    mode === "characters"
                      ? generatePassword(options)
                      : generatePassphrase(phraseOptions);
                } catch {
                  setGenerationFailed(true);
                  return;
                }
                setGenerationFailed(false);
                onGenerated(generated);
              }}
            >
              Generate
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
