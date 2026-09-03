import { ProviderFields } from "./ProviderFields";
import { SyncConflictPanel } from "./SyncConflictPanel";
import type { ProviderKind, SyncSectionOptions } from "./types";
import { useSyncSection } from "./useSyncSection";

export function SyncSection(props: SyncSectionOptions) {
  const sync = useSyncSection(props);
  return (
    <section className="sync-section" aria-labelledby="sync-heading">
      <div className="section-heading-row">
        <div>
          <p className="eyebrow">Desktop explicit sync</p>
          <h2 id="sync-heading">Sync</h2>
        </div>
        <select
          aria-label="Saved sync profile"
          value={sync.selectedId ?? ""}
          disabled={sync.busy}
          onChange={(event) => {
            if (event.target.value === "") {
              sync.startNewProfile();
              return;
            }
            const profile = sync.profiles.find(
              (candidate) => candidate.profileId === event.target.value,
            );
            if (profile !== undefined) sync.selectProfile(profile);
          }}
        >
          <option value="">New profile</option>
          {sync.profiles.map((profile) => (
            <option key={profile.profileId} value={profile.profileId}>
              {profile.target.provider === "webdav" ? "WebDAV" : "S3"}
              {profile.available ? "" : " (different vault)"}
            </option>
          ))}
        </select>
      </div>
      <div className="sync-grid">
        <label className="form-field">
          Provider
          <select
            value={sync.provider}
            disabled={sync.busy}
            onChange={(event) => {
              sync.setSelectedId(null);
              sync.setProvider(event.target.value as ProviderKind);
            }}
          >
            <option value="webdav">WebDAV</option>
            <option value="s3">S3 / compatible</option>
          </select>
        </label>
        <ProviderFields
          provider={sync.provider}
          busy={sync.busy}
          resourceUrl={sync.resourceUrl}
          endpoint={sync.endpoint}
          region={sync.region}
          bucket={sync.bucket}
          objectKey={sync.objectKey}
          pathStyle={sync.pathStyle}
          username={sync.username}
          webdavPassword={sync.webdavPassword}
          accessKeyId={sync.accessKeyId}
          secretAccessKey={sync.secretAccessKey}
          sessionToken={sync.sessionToken}
          onResourceUrl={sync.setResourceUrl}
          onEndpoint={sync.setEndpoint}
          onRegion={sync.setRegion}
          onBucket={sync.setBucket}
          onObjectKey={sync.setObjectKey}
          onPathStyle={sync.setPathStyle}
          onUsername={sync.setUsername}
          onWebdavPassword={sync.setWebdavPassword}
          onAccessKeyId={sync.setAccessKeyId}
          onSecretAccessKey={sync.setSecretAccessKey}
          onSessionToken={sync.setSessionToken}
        />
        <label className="form-field sync-wide">
          Vault master password
          <input
            type="password"
            value={sync.masterPassword}
            autoComplete="off"
            disabled={sync.busy}
            onChange={(event) => {
              sync.setMasterPassword(event.target.value);
            }}
          />
        </label>
      </div>
      <p className="sync-note">
        Provider credentials and the master password are used once and are not
        persisted.
      </p>
      <div className="dialog-actions stacked-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={sync.busy || !sync.providerConfigComplete}
          onClick={() => void sync.saveProfile()}
        >
          Save non-secret profile
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={
            sync.busy || sync.selected === null || !sync.credentialsComplete
          }
          onClick={() => void sync.testConnection()}
        >
          Test connection
        </button>
        <button
          type="button"
          disabled={sync.syncUnavailable}
          onClick={() => void sync.syncNow()}
        >
          Sync now
        </button>
      </div>
      <p className="sync-status" role="status" aria-live="polite">
        {sync.status}
      </p>
      {props.disabled ? (
        <p className="sync-warning">
          Save or finish the current draft before syncing.
        </p>
      ) : null}
      {sync.error === null ? null : (
        <p className="detail-error" role="alert">
          {sync.error}
        </p>
      )}
      {sync.conflict === null ? null : (
        <SyncConflictPanel
          conflict={sync.conflict}
          confirmChoice={sync.confirmChoice}
          busy={sync.busy}
          confirmationDisabled={sync.syncUnavailable}
          onChoose={sync.setConfirmChoice}
          onConfirm={(choice) => void sync.resolveConflict(choice)}
          onBack={() => {
            sync.setConfirmChoice(null);
          }}
          onCancel={() => {
            sync.setConflict(null);
          }}
        />
      )}
    </section>
  );
}
