import type { MobileSelectedVaultDto } from "../../types/mobile";
import type { RuntimePlatform } from "../../types/runtime";
import { MOBILE_AUTO_LOCK_OPTIONS } from "./useMobileIdleSecurity";

interface Props {
  platform: Extract<RuntimePlatform, "android" | "ios">;
  selected: MobileSelectedVaultDto;
  dirty: boolean;
  hasDraft: boolean;
  readOnly: boolean;
  busy: boolean;
  blocked: boolean;
  saved: boolean;
  saveDisabled: boolean;
  timeoutMs: number | null;
  onTimeout: (timeoutMs: number | null) => void;
  onSave: () => void;
  onLock: () => void;
}

export function MobileUnlockedHeader(props: Props) {
  return (
    <header className="top-bar mobile-top-bar">
      <div className="product-lockup">
        <span className="brand-mark small" aria-hidden="true">
          N
        </span>
        <div>
          <p className="eyebrow">
            {props.platform === "ios" ? "iOS" : "Android"} ·{" "}
            {props.readOnly || !props.selected.writable
              ? "Read only"
              : "Explicit Save"}
          </p>
          <h1>Nian Pass</h1>
          <p className="mobile-file-name">{props.selected.fileName}</p>
          {props.dirty ? (
            <p className="dirty-indicator" role="status">
              Unsaved changes
            </p>
          ) : null}
        </div>
      </div>
      <div className="top-bar-actions">
        {props.readOnly ? null : (
          <label className="mobile-timeout-control">
            Auto-lock
            <select
              aria-label="Mobile auto-lock timeout"
              value={
                props.timeoutMs === null ? "never" : String(props.timeoutMs)
              }
              onChange={(event) => {
                const next = event.currentTarget.value;
                props.onTimeout(next === "never" ? null : Number(next));
              }}
            >
              {MOBILE_AUTO_LOCK_OPTIONS.map((option) => (
                <option
                  key={option.label}
                  value={
                    option.timeoutMs === null
                      ? "never"
                      : String(option.timeoutMs)
                  }
                >
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <span
          className="save-status"
          aria-live="polite"
          hidden={props.readOnly}
        >
          {props.saved && !props.dirty ? "Saved" : ""}
        </span>
        {props.readOnly ? null : (
          <button
            type="button"
            aria-label="Save vault"
            disabled={props.saveDisabled}
            title={
              props.hasDraft
                ? "Apply or cancel the current draft before saving"
                : undefined
            }
            onClick={props.onSave}
          >
            Save
          </button>
        )}
        <button
          className="secondary-button lock-button"
          type="button"
          disabled={props.busy || props.blocked}
          onClick={props.onLock}
        >
          Lock
        </button>
      </div>
    </header>
  );
}
