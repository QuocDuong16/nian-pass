# Sync architecture

- `crates/vault-sync` owns semantic three-way KDBX merge. `crates/sync-engine` owns the provider-independent transaction/orchestration layer. `crates/sync-provider-core` defines bounded opaque-byte operations; WebDAV, S3, and gateway crates implement transports.
- Providers exchange encrypted KDBX bytes plus an opaque remote revision. Keep KDBX parsing and merge semantics client-side; the self-hosted gateway must not learn plaintext or credentials.
- Sync is explicit and user-triggered. Preserve immutable local-source/remote-target profile identity, exact conditional writes, explicit conflict outcomes, ciphertext read-back verification, and journal/BASE-last recovery.
- A successful response does not prove a malicious provider honored conditional headers; do not claim cryptographic rollback protection or unconditional CAS enforcement.
- Source map: `crates/vault-sync`, `crates/sync-engine`, `crates/sync-provider-core`, `crates/sync-provider-webdav`, `crates/sync-provider-s3`, `crates/sync-provider-gateway`, `apps/sync-gateway`. Read M7/M7.5 sections of `docs/architecture.md` and `docs/threat-model.md` before changing the protocol.