import type { EntryIconDto } from "../../types/desktop";
import {
  STANDARD_ENTRY_ICONS,
  entryIconLabel,
  type EntryIconSelection,
} from "./entry-icons";

interface EntryIconEditorProps {
  current: EntryIconDto;
  value: EntryIconSelection;
  disabled: boolean;
  onChange: (value: EntryIconSelection) => void;
}

export function EntryIconEditor({
  current,
  value,
  disabled,
  onChange,
}: EntryIconEditorProps) {
  const preserveCurrent =
    current.kind === "custom" || current.kind === "non_standard";

  return (
    <div className="form-field entry-icon-editor">
      <label htmlFor="entry-icon">Icon</label>
      <select
        id="entry-icon"
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.currentTarget.value as EntryIconSelection);
        }}
      >
        {preserveCurrent ? (
          <option value="preserve">
            Keep current: {entryIconLabel(current)}
          </option>
        ) : null}
        <option value="none">No explicit icon</option>
        <optgroup label="KeePass standard icons">
          {STANDARD_ENTRY_ICONS.map(([id, label]) => (
            <option key={id} value={`built_in:${String(id)}`}>
              {String(id).padStart(2, "0")} · {label}
            </option>
          ))}
        </optgroup>
      </select>
      <small>
        Standard icons round-trip through KDBX. Use Upload PNG from entry detail
        for a new custom icon; historical icon references remain preserved.
      </small>
    </div>
  );
}
