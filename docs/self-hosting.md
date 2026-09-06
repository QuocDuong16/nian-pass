# Self-hosting the Nian Pass Sync Gateway

The M7.5 Sync Gateway is an experimental Linux self-hosted transport for one or
more opaque encrypted KDBX objects. It is not an account system, a password
manager backend, or a merge service. Nian Pass desktop remains the only merge
authority and sends or receives the exact encrypted KDBX bytes through
authenticated `GET` and conditional `PUT` requests.

Nian Pass is still pre-release software. M7.5 does not make it production-ready
and does not replace independent backups.

## Trust and metadata

The gateway has no KDBX parser and receives no master password, vault password,
decryption key, entry title, username, password, note, group, or KDBX XML. A
gateway operator or copied gateway volume can observe vault IDs, encrypted
object sizes, access timing, network metadata, and current ciphertext. The
gateway is zero-knowledge about KDBX plaintext, but it is not anonymous.

A malicious gateway administrator or host root can delete, withhold, copy,
rollback, or fork ciphertext and can deny service. M7.5 has no cryptographic
remote rollback protection. An administrator still cannot derive KDBX
plaintext without the vault credential, assuming the KDBX encryption remains
secure.

## Data directory and process model

The binary defaults to `/data` and creates the storage root and temporary
directory with mode `0700`; object, temporary, and lock files use mode `0600`.
Each object filename is derived only from a validated canonical UUID-v4 vault
ID. Symlinks and unexpected object types are rejected.

The gateway takes an exclusive process lock on its data root. Run exactly one
gateway process against a volume. Active-active replicas, shared-volume
multi-process deployment, distributed locking, and clustering are unsupported
and are rejected when the local filesystem lock is visible. Do not use a
filesystem whose rename, file sync, directory sync, or advisory-lock behavior
does not provide ordinary local Linux filesystem semantics.

Writes are limited to 64 MiB, use private temporary files, sync the complete
file, validate the conditional revision while holding the per-vault lock,
atomically rename the new generation, and sync the parent directory. SIGTERM or
SIGINT stops acceptance and gives bounded in-flight work time to finish. The
gateway never rewrites vaults in the background.

## Authentication token

Configure one high-entropy token of 32 through 512 visible ASCII characters.
Spaces, tabs, line breaks, other control characters, and non-ASCII characters
are rejected by the shared server/client token-format policy.
There is no default credential. Supply exactly one of:

```text
NIAN_PASS_GATEWAY_TOKEN
NIAN_PASS_GATEWAY_TOKEN_FILE
--token-file PATH
```

Use an appropriately owned secret file for a native service. Use the private
environment-file workflow documented below for Compose or direct Docker. The
gateway hashes the configured token in memory and compares request digests without a naive
early-exit string comparison. It never returns or logs the token. Rotate a
token by stopping the gateway, replacing the secret, and starting it again;
desktop clients must then enter the new token for each explicit operation.

Authentication limits casual unauthorized storage use, but M7.5 does not add
per-client ACLs, accounts, brute-force rate limiting across reverse proxies, or
a quota/billing system. Restrict network reachability and apply appropriate
rate limiting at the reverse proxy when exposed beyond a private network.

## TLS and reverse proxy

The gateway listens with plain HTTP. For any non-loopback deployment, place it
behind an HTTPS reverse proxy or ingress with normal certificate and hostname
verification:

```text
Internet or private network
→ HTTPS reverse proxy
→ 127.0.0.1:8080 gateway HTTP listener
```

Do not expose the plain listener publicly. Preserve `Authorization`,
`If-Match`, `If-None-Match`, `ETag`, `Content-Type`, and exact binary request and
response bodies. Configure proxy request limits at or below 64 MiB, bounded
header and body timeouts, and no request-body or Authorization logging. Do not
cache vault responses and do not transform or compress uploaded ciphertext.

Nian Pass desktop requires HTTPS for non-loopback gateway URLs. HTTP is accepted
only for `localhost`, `127.0.0.0/8`, or `::1` development and tests. There is no
certificate-validation bypass.

## Container deployment

The supported Compose path injects the token from a private environment file.
This avoids the host-ownership ambiguity of bind-backed Compose secrets while
keeping the final gateway process at UID/GID 10001. Create the ignored file with
a random high-entropy token and keep it private:

```bash
umask 077
printf 'NIAN_PASS_GATEWAY_TOKEN=' > deploy/gateway.env
openssl rand -base64 48 | tr -d '\n' >> deploy/gateway.env
printf '\n' >> deploy/gateway.env
chmod 0600 deploy/gateway.env
docker compose --env-file deploy/gateway.env \
  -f deploy/sync-gateway.compose.yml up --build -d
```

The Compose example builds the multi-stage
`apps/sync-gateway/Dockerfile`, runs as UID/GID 10001, persists only `/data` in a
named volume, and binds the HTTP port to loopback for an external reverse proxy.
The token is runtime configuration: it is not a bind-mounted file, command-line
argument, image layer, or build input. The private host environment file is
gitignored and dockerignored at the exact path `deploy/gateway.env`, remains mode
`0600`, and is read by Compose rather than sent in the Docker build context. The
non-root process reads the resulting runtime environment value. As with other
container environment secrets, the Docker daemon, container runtime
administrator, and host root can inspect it; those principals already control
the gateway process and ciphertext. The final image contains only the gateway
binary and minimal Debian runtime.

Direct `docker run` is an advanced equivalent. It uses the same private
environment file and therefore does not depend on bind-mount UID mapping:

```bash
docker build -f apps/sync-gateway/Dockerfile -t nian-pass-sync-gateway .
docker volume create nian-pass-gateway-data
docker run --rm --name nian-pass-sync-gateway \
  --user 10001:10001 \
  --env-file "$PWD/deploy/gateway.env" \
  -p 127.0.0.1:8080:8080 \
  -v nian-pass-gateway-data:/data \
  nian-pass-sync-gateway
```

## Health check

`GET /healthz` is unauthenticated and returns only `200 OK` with a fixed `OK`
body. It does not disclose paths, vault IDs, token state, environment variables,
versions, or host details.

## Desktop setup

On Windows or Linux desktop, open Sync, choose **Nian Pass Gateway**, and enter:

1. the external HTTPS gateway base URL;
2. a UUID-v4 vault ID (a new profile receives a generated ID; copy an existing
   ID to attach another desktop to the same object);
3. the gateway access token;
4. the vault master password.

Save stores only the normalized gateway URL and vault ID. The access token and
master password are cleared after each Save, Test connection, Sync now, or
conflict-resolution operation and are never stored in the profile, BASE, or
journal. Changing URL or vault ID requires a new profile UUID.

Sync remains explicit. There is no startup, background, file-watch, push,
WebSocket, browser-direct, Android network, or Apple runtime sync.

## Backup, restore, and upgrade

Back up the complete stopped `/data` volume with its permissions preserved. A
gateway backup contains encrypted KDBX data and is not sufficient to decrypt
the vault. Loss of both local vault copies and gateway storage can still lose
data. Test restores separately and retain multiple independently protected
backup generations because a malicious or mistaken operator can roll storage
back.

Before upgrading, stop the one gateway process and take a volume backup. M7.5
has no database migration or metadata sidecar: the stored `.kdbx` object bytes
are the data. Start the new image against the same private volume, verify
`/healthz`, then use desktop **Test connection** and an explicit **Sync now**.
Do not run old and new gateway processes concurrently against the same volume.

## Deliberate limits

M7.5 provides no web UI, accounts, sharing, ACL management, server-side merge or
search, version-history UI, S3/database backend, active-active operation,
distributed lock, Windows gateway service, Kubernetes packaging, Android
network sync, Apple runtime work, or M8 release guarantees.
