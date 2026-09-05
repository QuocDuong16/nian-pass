interface ProviderFieldsProps {
  provider: "webdav" | "s3" | "gateway";
  busy: boolean;
  resourceUrl: string;
  endpoint: string;
  region: string;
  bucket: string;
  objectKey: string;
  pathStyle: boolean;
  username: string;
  webdavPassword: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  gatewayUrl: string;
  gatewayVaultId: string;
  gatewayToken: string;
  onResourceUrl: (value: string) => void;
  onEndpoint: (value: string) => void;
  onRegion: (value: string) => void;
  onBucket: (value: string) => void;
  onObjectKey: (value: string) => void;
  onPathStyle: (value: boolean) => void;
  onUsername: (value: string) => void;
  onWebdavPassword: (value: string) => void;
  onAccessKeyId: (value: string) => void;
  onSecretAccessKey: (value: string) => void;
  onSessionToken: (value: string) => void;
  onGatewayUrl: (value: string) => void;
  onGatewayVaultId: (value: string) => void;
  onGatewayToken: (value: string) => void;
}

export function ProviderFields(props: ProviderFieldsProps) {
  if (props.provider === "webdav") {
    return (
      <>
        <label className="form-field sync-wide">
          Remote KDBX URL
          <input
            type="url"
            value={props.resourceUrl}
            disabled={props.busy}
            onChange={(event) => {
              props.onResourceUrl(event.target.value);
            }}
          />
        </label>
        <label className="form-field">
          WebDAV username
          <input
            value={props.username}
            autoComplete="username"
            disabled={props.busy}
            onChange={(event) => {
              props.onUsername(event.target.value);
            }}
          />
        </label>
        <label className="form-field">
          WebDAV password
          <input
            type="password"
            value={props.webdavPassword}
            autoComplete="off"
            disabled={props.busy}
            onChange={(event) => {
              props.onWebdavPassword(event.target.value);
            }}
          />
        </label>
      </>
    );
  }
  if (props.provider === "gateway") {
    return (
      <>
        <label className="form-field sync-wide">
          Gateway URL
          <input
            type="url"
            value={props.gatewayUrl}
            disabled={props.busy}
            onChange={(event) => {
              props.onGatewayUrl(event.target.value);
            }}
          />
        </label>
        <label className="form-field sync-wide">
          Vault ID
          <input
            value={props.gatewayVaultId}
            autoComplete="off"
            disabled={props.busy}
            onChange={(event) => {
              props.onGatewayVaultId(event.target.value);
            }}
          />
        </label>
        <label className="form-field sync-wide">
          Access token
          <input
            type="password"
            value={props.gatewayToken}
            autoComplete="off"
            disabled={props.busy}
            onChange={(event) => {
              props.onGatewayToken(event.target.value);
            }}
          />
        </label>
      </>
    );
  }
  return (
    <>
      <label className="form-field">
        Endpoint (optional)
        <input
          type="url"
          value={props.endpoint}
          disabled={props.busy}
          onChange={(event) => {
            props.onEndpoint(event.target.value);
          }}
        />
      </label>
      <label className="form-field">
        Region
        <input
          value={props.region}
          disabled={props.busy}
          onChange={(event) => {
            props.onRegion(event.target.value);
          }}
        />
      </label>
      <label className="form-field">
        Bucket
        <input
          value={props.bucket}
          disabled={props.busy}
          onChange={(event) => {
            props.onBucket(event.target.value);
          }}
        />
      </label>
      <label className="form-field">
        Object key
        <input
          value={props.objectKey}
          disabled={props.busy}
          onChange={(event) => {
            props.onObjectKey(event.target.value);
          }}
        />
      </label>
      <label className="form-field checkbox-field">
        <input
          type="checkbox"
          checked={props.pathStyle}
          disabled={props.busy}
          onChange={(event) => {
            props.onPathStyle(event.target.checked);
          }}
        />
        Path-style addressing
      </label>
      <label className="form-field">
        Access key ID
        <input
          value={props.accessKeyId}
          autoComplete="off"
          disabled={props.busy}
          onChange={(event) => {
            props.onAccessKeyId(event.target.value);
          }}
        />
      </label>
      <label className="form-field">
        Secret access key
        <input
          type="password"
          value={props.secretAccessKey}
          autoComplete="off"
          disabled={props.busy}
          onChange={(event) => {
            props.onSecretAccessKey(event.target.value);
          }}
        />
      </label>
      <label className="form-field">
        Session token (optional)
        <input
          type="password"
          value={props.sessionToken}
          autoComplete="off"
          disabled={props.busy}
          onChange={(event) => {
            props.onSessionToken(event.target.value);
          }}
        />
      </label>
    </>
  );
}
