import { AUTO_LOCK_OPTIONS } from "./useIdleSecurity";

interface AutoLockControlProps {
  disabled: boolean;
  timeoutMs: number | null;
  onChange: ((timeoutMs: number | null) => void) | undefined;
}

export function AutoLockControl({
  disabled,
  timeoutMs,
  onChange,
}: AutoLockControlProps) {
  return (
    <label className="auto-lock-control">
      <span>Auto-lock</span>
      <select
        aria-label="Auto-lock timeout"
        value={timeoutMs === null ? "never" : String(timeoutMs)}
        disabled={disabled}
        onChange={(event) => {
          const value = event.currentTarget.value;
          onChange?.(value === "never" ? null : Number(value));
        }}
      >
        {AUTO_LOCK_OPTIONS.map((option) => (
          <option key={option.label} value={option.timeoutMs ?? "never"}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
