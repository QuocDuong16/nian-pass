import { ProviderFields } from "./ProviderFields";
import { SyncConflictPanel } from "./SyncConflictPanel";
import { SyncProfileSelect } from "./SyncProfileSelect";
import type { ProviderKind, SyncSectionOptions } from "./types";
import { useSyncSection } from "./useSyncSection";

export function SyncSection(props: SyncSectionOptions) {
  const sync = useSyncSection(props);
  return (
    <section
      className="sync-section"
      aria-labelledby={props.embedded ? undefined : "sync-heading"}
      aria-label={props.embedded ? "Sync configuration" : undefined}
    >
      <SyncProfileSelect
        profiles={sync.profiles}
        selectedId={sync.selectedId}
        busy={sync.busy}
        embedded={props.embedded === true}
        onNew={sync.startNewProfile}
        onSelect={sync.selectProfile}
      />
      <div className="sync-grid">
        <label className="form-field">
          Provider
          <select
            value={sync.provider}
            disabled={sync.busy}
            onChange={(event) => {
              sync.chooseProvider(event.target.value as ProviderKind);
            }}
          >
            <option value="webdav">WebDAV</option>
            <option value="s3">S3 / compatible</option>
            <option value="gateway">Nian Pass Gateway</option>
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
          gatewayUrl={sync.gatewayUrl}
          gatewayVaultId={sync.gatewayVaultId}
          gatewayToken={sync.gatewayToken}
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
          onGatewayUrl={sync.setGatewayUrl}
          onGatewayVaultId={sync.setGatewayVaultId}
          onGatewayToken={sync.setGatewayToken}
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
        Provider credentials and any entered password are used once, then
        cleared from this form. The active keyfile stays in Rust and is never
        copied into browser state or sync profiles.
        {sync.hasKeyfile === true
          ? " Leave the master password blank for keyfile-only vaults; enter it for password + keyfile vaults."
          : sync.hasKeyfile === false
            ? " Enter the vault master password to synchronize."
            : " Checking the active keyfile before enabling synchronization."}
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
            sync.busy ||
            sync.selected === null ||
            sync.selected.recoveryStatus === "unsupported" ||
            !sync.credentialsComplete
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
      {sync.selected?.recoveryStatus === "unsupported" ? (
        <div className="sync-warning" role="alert">
          <p>
            This sync metadata was created by an older or incompatible Nian Pass
            build. It cannot be safely resumed because its remote target
            identity was not recorded.
          </p>
          <p>
            Resetting removes only Nian Pass sync metadata. It does not modify
            the local vault or remote vault. The next sync will re-establish the
            relationship and may require an initial conflict decision.
          </p>
          {sync.confirmReset ? (
            <div className="dialog-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={sync.busy}
                onClick={() => {
                  sync.setConfirmReset(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={sync.busy}
                onClick={() => void sync.resetSyncState()}
              >
                Confirm reset sync state
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="secondary-button"
              disabled={sync.busy || props.disabled}
              onClick={() => {
                sync.setConfirmReset(true);
              }}
            >
              Reset sync state
            </button>
          )}
        </div>
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
