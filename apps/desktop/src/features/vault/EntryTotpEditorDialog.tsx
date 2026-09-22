import { Button } from "../../components/Button";
import { validTotpUri } from "./totp-validation";

export type TotpEditorMode = "replace" | "clear";

interface Props {
  mode: TotpEditorMode;
  uri: string;
  applying: boolean;
  failed: boolean;
  onUri: (value: string) => void;
  onCancel: () => void;
  onApply: () => void;
}

export function EntryTotpEditorDialog(props: Props) {
  const invalid = props.mode === "replace" && !validTotpUri(props.uri);
  return (
    <div className="modal-backdrop">
      <section
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="totp-editor-title"
      >
        <h2 id="totp-editor-title">
          {props.mode === "clear" ? "Remove TOTP?" : "Configure TOTP"}
        </h2>
        {props.mode === "clear" ? (
          <p>
            The TOTP configuration will be removed from this entry after you
            save the vault.
          </p>
        ) : (
          <>
            <label htmlFor="totp-uri">Provisioning URI</label>
            <input
              id="totp-uri"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={props.uri}
              onChange={(event) => {
                props.onUri(event.currentTarget.value);
              }}
              placeholder="otpauth://totp/…"
              autoFocus
            />
            <small>
              Paste an otpauth://totp URI. Existing seeds are never loaded into
              the WebView.
            </small>
            {props.uri !== "" && invalid ? (
              <p role="alert">
                Enter a valid TOTP provisioning URI with a secret.
              </p>
            ) : null}
          </>
        )}
        {props.failed ? (
          <p role="alert">Could not update the TOTP configuration.</p>
        ) : null}
        <div className="dialog-actions">
          <Button
            size="sm"
            variant="secondary"
            type="button"
            disabled={props.applying}
            onClick={props.onCancel}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            variant={props.mode === "clear" ? "danger" : "primary"}
            type="button"
            disabled={props.applying || invalid}
            onClick={props.onApply}
          >
            {props.applying
              ? "Applying…"
              : props.mode === "clear"
                ? "Remove TOTP"
                : "Save TOTP"}
          </Button>
        </div>
      </section>
    </div>
  );
}
