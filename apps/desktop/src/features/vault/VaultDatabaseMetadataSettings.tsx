import { useEffect, useMemo, useState } from "react";

import { Button } from "../../components/Button";
import type { DesktopApi } from "../../lib/desktop";
import type {
  DatabaseMetadataDto,
  VaultSnapshotDto,
} from "../../types/desktop";

const MAX_DATABASE_NAME_CHARS = 1024;
const MAX_DATABASE_DESCRIPTION_CHARS = 16 * 1024;
const MAX_DEFAULT_USERNAME_CHARS = 1024;

interface Props {
  api: DesktopApi;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onSnapshot: (snapshot: VaultSnapshotDto) => void;
}

export function VaultDatabaseMetadataSettings(props: Props) {
  const [canonical, setCanonical] = useState<DatabaseMetadataDto | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [defaultUsername, setDefaultUsername] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void props.api
      .getDatabaseMetadata()
      .then((metadata) => {
        if (!active) return;
        setCanonical(metadata);
        setName(metadata.name);
        setDescription(metadata.description);
        setDefaultUsername(metadata.defaultUsername);
        setStatus(null);
      })
      .catch(() => {
        if (active) setStatus("Could not load database details.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [props.api]);

  const changed = useMemo(
    () =>
      canonical !== null &&
      (name !== canonical.name ||
        description !== canonical.description ||
        defaultUsername !== canonical.defaultUsername),
    [canonical, defaultUsername, description, name],
  );

  const save = async () => {
    if (props.disabled || busy || !changed) return;
    setBusy(true);
    props.onBusyChange(true);
    setStatus(null);
    try {
      const receipt = await props.api.updateDatabaseMetadata(
        name,
        description,
        defaultUsername,
      );
      setCanonical(receipt.metadata);
      setName(receipt.metadata.name);
      setDescription(receipt.metadata.description);
      setDefaultUsername(receipt.metadata.defaultUsername);
      props.onSnapshot(receipt.snapshot);
      setStatus("Database details updated. Save the vault to persist them.");
    } catch {
      setStatus("Could not update database details.");
    } finally {
      setBusy(false);
      props.onBusyChange(false);
    }
  };

  return (
    <section className="settings-card" aria-labelledby="database-details-title">
      <div className="settings-page-heading compact-heading">
        <strong id="database-details-title">Database details</strong>
        <p>
          Stored inside the KDBX database and loaded only while this settings
          page is open.
        </p>
      </div>
      {loading ? <p role="status">Loading database details…</p> : null}
      {canonical === null ? null : (
        <div className="settings-form-grid">
          <label>
            <span>Database name</span>
            <input
              value={name}
              maxLength={MAX_DATABASE_NAME_CHARS}
              disabled={props.disabled || busy}
              onChange={(event) => {
                setName(event.currentTarget.value);
              }}
            />
          </label>
          <label>
            <span>Description</span>
            <textarea
              value={description}
              maxLength={MAX_DATABASE_DESCRIPTION_CHARS}
              disabled={props.disabled || busy}
              onChange={(event) => {
                setDescription(event.currentTarget.value);
              }}
            />
          </label>
          <label>
            <span>Default username</span>
            <input
              value={defaultUsername}
              maxLength={MAX_DEFAULT_USERNAME_CHARS}
              disabled={props.disabled || busy}
              onChange={(event) => {
                setDefaultUsername(event.currentTarget.value);
              }}
            />
          </label>
          <div className="settings-actions">
            <Button
              size="sm"
              variant="ghost"
              type="button"
              disabled={props.disabled || busy || !changed}
              onClick={() => void save()}
            >
              {busy ? "Updating…" : "Update details"}
            </Button>
          </div>
        </div>
      )}
      {status === null ? null : <p role="status">{status}</p>}
    </section>
  );
}
