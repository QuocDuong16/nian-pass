import { Button } from "../../components/Button";
import type { CustomFieldSummaryDto } from "../../types/desktop";
import { fieldActionLabel, fieldLabel } from "./custom-field-labels";

interface CustomFieldListProps {
  fields: CustomFieldSummaryDto[];
  disabled: boolean;
  onAdd: () => void;
  onEdit: (field: CustomFieldSummaryDto) => void;
  onDelete: (field: CustomFieldSummaryDto) => void;
}

export function CustomFieldList(props: CustomFieldListProps) {
  return (
    <>
      <div className="section-heading-row">
        <h3 id="custom-fields-label">Custom fields</h3>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          disabled={props.disabled}
          onClick={props.onAdd}
        >
          Add custom field
        </Button>
      </div>
      {props.fields.length === 0 ? <p>No custom fields.</p> : null}
      <ul className="custom-field-list">
        {props.fields.map((field) => (
          <li key={`${field.name}:${field.protection}`}>
            <span>{fieldLabel(field.name)}</span>
            <span
              className={`field-protection field-protection-${field.protection}`}
            >
              {field.protection === "protected" ? "Protected" : "Unprotected"}
            </span>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              aria-label={fieldActionLabel("Edit", field.name)}
              disabled={props.disabled}
              onClick={() => {
                props.onEdit(field);
              }}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              type="button"
              aria-label={fieldActionLabel("Delete", field.name)}
              disabled={props.disabled}
              onClick={() => {
                props.onDelete(field);
              }}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </>
  );
}
