interface EntryExpiryEditorProps {
  enabled: boolean;
  value: string;
  disabled: boolean;
  invalid: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onValueChange: (value: string) => void;
}

export function EntryExpiryEditor({
  enabled,
  value,
  disabled,
  invalid,
  onEnabledChange,
  onValueChange,
}: EntryExpiryEditorProps) {
  return (
    <div className="form-field entry-expiry-editor">
      <label className="checkbox-row">
        <input
          type="checkbox"
          aria-label="Entry expires"
          checked={enabled}
          disabled={disabled}
          onChange={(event) => {
            onEnabledChange(event.currentTarget.checked);
          }}
        />
        <span>Entry expires</span>
      </label>
      {enabled ? (
        <>
          <label htmlFor="entry-expiry">Expiry date and time</label>
          <input
            id="entry-expiry"
            type="datetime-local"
            value={value}
            disabled={disabled}
            aria-invalid={invalid}
            onChange={(event) => {
              onValueChange(event.currentTarget.value);
            }}
          />
          {invalid ? (
            <small role="alert">Choose a valid expiry date and time.</small>
          ) : (
            <small>
              The entry remains usable until this local date and time.
            </small>
          )}
        </>
      ) : (
        <small>This entry does not expire.</small>
      )}
    </div>
  );
}
