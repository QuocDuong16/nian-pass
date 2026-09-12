import { useMemo, useState } from "react";

import { generatePassword, type GeneratorOptions } from "./password-generation";

interface PasswordGeneratorProps {
  disabled?: boolean;
  onGenerated: (password: string) => void;
}

export function PasswordGenerator({
  disabled = false,
  onGenerated,
}: PasswordGeneratorProps) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<GeneratorOptions>({
    length: 24,
    uppercase: true,
    lowercase: true,
    digits: true,
    symbols: true,
    avoidAmbiguous: true,
  });
  const valid =
    options.uppercase || options.lowercase || options.digits || options.symbols;
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
          <label>
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
          <div className="generator-footer">
            <span>Password quality: {quality}</span>
            <button
              type="button"
              disabled={disabled || !valid}
              onClick={() => {
                onGenerated(generatePassword(options));
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
