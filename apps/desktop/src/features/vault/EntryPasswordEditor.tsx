import { PasswordGenerator } from "./PasswordGenerator";

interface EntryPasswordEditorProps {
  value: string | null;
  disabled: boolean;
  onChange: (value: string) => void;
}

export function EntryPasswordEditor({
  value,
  disabled,
  onChange,
}: EntryPasswordEditorProps) {
  return (
    <div className="form-field">
      <label htmlFor="new-password">Password</label>
      {value === null ? (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onChange("");
          }}
        >
          Set new password
        </button>
      ) : (
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            onChange(event.currentTarget.value);
          }}
        />
      )}
      <small>
        Existing password is never preloaded. Empty sets an empty password.
      </small>
      <PasswordGenerator disabled={disabled} onGenerated={onChange} />
    </div>
  );
}
