---
type: Architecture Overview
title: Nian Pass — Architecture
description: Workspace structure, crate dependency direction, domain model, architecture invariants, security boundaries, KDBX adapter design, desktop app design, three-way sync engine, and verified persistence for Nian Pass.
tags: [architecture, domain-model, design, security, sync, persistence, desktop]
---

# Architecture Overview

Nian Pass is a KDBX-native, offline-first password manager. The `.kdbx` file is the source of truth. The workspace provides read/write KDBX operations, verified local persistence, a provider-independent three-way semantic merge engine, and a Tauri 2 desktop application.

## Dependency Direction

```mermaid
flowchart TD
    DESKTOP["Desktop App\napps/desktop/src-tauri"]
    CLI["nian-pass CLI\napps/cli"]
    GATEWAY["Sync Gateway\napps/sync-gateway"]
    BROWSER_HOST["Browser Host\napps/browser-native-host"]
    BROWSER_EXT["Browser Extension\napps/browser-extension"]
    SE["sync-engine\ncrate"]
    SPG["sync-provider-gateway\ncrate"]
    SPS["sync-provider-s3\ncrate"]
    SPW["sync-provider-webdav\ncrate"]
    SPCORE["sync-provider-core\ncrate"]
    GWPROT["sync-gateway-protocol\ncrate"]
    BNPROT["browser-native-protocol\ncrate"]
    CPCORE["credential-provider-core\ncrate"]
    VS["vault-sync\nvault-sync crate"]
    VSESS["vault-session\nvault-session crate"]
    VC["vault-core\nvault-core crate"]
    KDBX["KDBX adapter\nkdbx crate"]
    KEEPASS["keepass-rs\nexternal crate"]

    DESKTOP --> VSESS
    DESKTOP --> VC
    DESKTOP --> SE
    DESKTOP --> BNPROT
    DESKTOP --> CPCORE
    SE --> VS
    SE --> SPCORE
    SE --> KDBX
    SE --> VC
    SPG --> SPCORE
    SPG --> VC
    SPS --> SPCORE
    SPW --> SPCORE
    SPCORE --> VC
    GWPROT -.-> GATEWAY
    GWPROT -.-> SPG
    CLI --> KDBX
    CLI --> VC
    VSESS --> KDBX
    VSESS --> VC
    VS --> KDBX
    VS --> VC
    KDBX --> VC
    KDBX --> KEEPASS
    GATEWAY --> GWPROT
    GATEWAY --> SPCORE
    BROWSER_HOST --> BNPROT
    BROWSER_EXT -.->|"connectNative"| BROWSER_HOST

    style VC fill:#e8f5e9,stroke:#2e7d32
    style KDBX fill:#e3f2fd,stroke:#1565c0
    style KEEPASS fill:#fff3e0,stroke:#e65100
    style CLI fill:#fce4ec,stroke:#c62828
    style VSESS fill:#f3e5f5,stroke:#7b1fa2
    style VS fill:#e0f2f1,stroke:#00695c
    style DESKTOP fill:#e1f5fe,stroke:#0277bd
    style SE fill:#fff8e1,stroke:#f57f17
    style SPCORE fill:#e0f2f1,stroke:#00695c
    style GATEWAY fill:#fce4ec,stroke:#c62828
    style BROWSER_HOST fill:#fff3e0,stroke:#e65100
    style BROWSER_EXT fill:#fce4ec,stroke:#ad1457
```

- **`vault-core`** owns KDBX-independent domain types including secret handling. It has no dependency on any KDBX library.
- **`kdbx`** is the adapter that contains all `keepass-rs` types, converts them to the domain model, and provides mutations, save, and three-way merge. `keepass` types are intentionally confined to this crate's private implementation.
- **`vault-session`** owns filesystem paths and the verified atomic persistence protocol. It depends on `kdbx` and `vault-core` but never exposes `keepass-rs` types.
- **`vault-sync`** is a thin orchestration layer over the three-way merge engine. It has no filesystem, network, or async responsibility.
- **`sync-engine`** orchestrates encrypted vault sync: local generation management, journal-based crash recovery, and conflict authority. It depends on `vault-sync` for merge and `sync-provider-core` for the remote transport trait.
- **`sync-provider-core`** defines the provider-neutral `RemoteObjectProvider` trait with CAS operations (`read`, `create_if_absent`, `replace_if_revision`). No network or filesystem responsibility.
- **`sync-provider-s3`**, **`sync-provider-webdav`**, and **`sync-provider-gateway`** implement the `RemoteObjectProvider` trait for their respective transports.
- **`sync-gateway-protocol`** is a thin shared crate defining wire-format invariants (token bounds) used by both the gateway server and client transports.
- **`browser-native-protocol`** defines the strict bounded IPC protocol between the browser extension and the desktop app, using length-prefixed JSON over OS-local sockets.
- **`credential-provider-core`** owns platform-neutral credential matching and secret retrieval policy, used by both Android autofill and the desktop browser bridge.
- **`apps/cli`** consumes only the adapter's public API and `vault-core` values. It never imports `keepass` directly.
- **`apps/desktop`** depends on `vault-session`, `vault-core`, `sync-engine`, `browser-native-protocol`, and `credential-provider-core`. The Tauri backend exposes a secret-free IPC surface; the React frontend receives only presentation DTOs.
- **`apps/sync-gateway`** is a standalone HTTP server that stores opaque encrypted KDBX bytes. It never parses vault contents and uses conditional CAS writes.
- **`apps/browser-native-host`** is a stateless bidirectional proxy relaying messages between the browser extension's stdio and the desktop's local socket. It never opens KDBX or owns a vault session.

## Domain Model

The domain model is a **secret-free presentation projection** of an opened vault, plus narrow request and metadata types for structural operations. Group names, custom-field names, visible entry metadata, and identifiers remain privacy-sensitive.

### Core Types (`vault-core`)

| Type | Purpose |
|---|---|
| `Vault` | Read-only view of an opened vault. Wraps the root `Group`. |
| `Group` | A named vault group with child groups and entries. Supports recursive `find_group` by `GroupId`. |
| `EntrySummary` | Secret-free entry projection: id, title, username, URL (as `SummaryText`), tags, `has_password`, `has_notes`. |
| `SummaryText` | `Missing \| Visible(String) \| Protected` — avoids leaking protected plaintext in projections. |
| `SecretString` | Zeroizing owned plaintext wrapper. No `Debug`, `Clone`, `Display`, or serialization. |
| `CustomFieldSummary` | Privacy-sensitive field name + `FieldProtection`, no value. |
| `FieldProtection` | `Protected \| Unprotected` — encryption state of a custom field. |
| `NewEntry` | Creation request DTO: title, username, URL, optional `SecretString` password. |
| `GroupId` | Stable group identifier copied across the adapter boundary. |
| `EntryId` | Stable entry identifier copied across the adapter boundary. |

**Key design decisions:**

- `Vault`, `Group`, `EntrySummary`, `SummaryText`, `SecretString`, and `CustomFieldSummary` do **not** implement `Debug`, preventing accidental dumps.
- `SecretString` uses `zeroize::Zeroizing<String>` internally; plaintext access is explicit via `expose_secret()`.
- `GroupId` and `EntryId` are opaque string wrappers — their format depends on the KDBX adapter.
- `group_count()` and `entry_count()` are O(n) recursive traversals. The domain model has no caching.

### KDBX Adapter (`kdbx`)

The adapter provides open, mutate, save, and three-way merge over a complete in-memory KDBX representation. `keepass-rs` types are entirely private.

**Open:**

```rust
pub fn open(path, master_password) -> Result<OpenedVault, KdbxError>
pub fn open_reader(reader, master_password) -> Result<OpenedVault, KdbxError>
```

**Entry mutations** (all use stable `EntryId`, preserve protection mode, track history):

| Method | Purpose |
|---|---|
| `set_entry_title` | Rename, preserving existing protection mode |
| `set_entry_username` | Change username, preserving protection mode |
| `set_entry_url` | Change URL without normalization |
| `set_entry_password` | Change password, preserving protection mode |
| `create_entry` | Create in a group, returns `EntryId` |
| `permanently_delete_entry` | Remove + tombstone (not recycle-bin) |
| `move_entry` | Relocate without field history |

**Group mutations:**

| Method | Purpose |
|---|---|
| `create_group` | Create beneath a parent, returns `GroupId` |
| `rename_group` | Rename without inventing entry history |
| `move_group` | Relocate with root/cycle validation |
| `permanently_delete_group` | Recursive subtree removal + tombstones |

**Custom fields:**

| Method | Purpose |
|---|---|
| `custom_fields(id)` | List names + protection metadata (no values) |
| `entry_custom_field(entry, name)` | Fetch one value as `SecretString` |
| `set_entry_custom_field` | Create or update, preserving existing protection |
| `delete_entry_custom_field` | Remove (no-op if missing) |

**Save and verification:**

| Method | Purpose |
|---|---|
| `save_to_writer(writer, password)` | Serialize to KDBX 4.1 only |
| `verify_semantic_equivalence(other)` | Structural equality ignoring salts/IVs |
| `semantically_equals(other)` | Boolean variant of above |

**Error variants** (`KdbxError`, `#[non_exhaustive]`):

| Variant | Meaning |
|---|---|
| `Io` | Database file could not be read |
| `InvalidKdbx` | Truncated, malformed, or not a KDBX file |
| `InvalidCredentials` | Master password rejected |
| `UnsupportedFormat` | KDBX format or feature not supported |
| `Conversion` | Valid database could not be represented by the domain model |
| `UnsupportedWriteFormat` | Only KDBX 4.1 is writable |
| `EntryNotFound` | No entry matched the stable identifier |
| `GroupNotFound` | No group matched the stable identifier |
| `CannotDeleteRootGroup` | Root group cannot be permanently deleted |
| `InvalidGroupMove` | Target would create cycle or move root |
| `ReservedField` | Generic custom-field API targeted a reserved name |
| `WriteIo` | Output writer rejected a write |
| `Serialization` | Complete document could not be serialized |
| `VerificationFailed` | Round-trip semantics differ |
| `SyncInvariant` | Sync candidate violated a required invariant |

## Desktop Application (Tauri 2 + React)

`apps/desktop` is the first visible Nian Pass application: a Tauri 2 shell with React, strict TypeScript, and Vite. The Tauri backend is in `apps/desktop/src-tauri/` and depends on `vault-session`, `vault-core`, `sync-engine`, `browser-native-protocol`, and `credential-provider-core`. The React frontend is in `apps/desktop/src/`.

**Backend (Rust):**
- 30+ Tauri IPC commands across classes: Utility, Session control, Vault read, Vault mutation, Save/reload, Sync, Browser, Android Credential/Autofill, and iOS (deferred)
- `AppState` holds at most one unlocked `VaultSession` behind `Arc<Mutex<...>>`
- All errors serialize as `DesktopErrorDto` with stable error codes — no paths, parser details, or secrets leak to IPC
- Only `tauri-plugin-dialog` is allowed; shell, HTTP, clipboard, fs, updater, and process plugins are forbidden
- `BrowserBridgeState` runs a background listener thread for Native Messaging approval flow
- Sync orchestration via `sync-engine` crate with provider abstraction (WebDAV, S3, Gateway)
- Mobile layer under `src/mobile/` for Android autofill, credential provider, and security lifecycle

**Frontend (React/TypeScript):**
- `lib/desktop.ts` is the sole IPC gateway — all `invoke()` calls are centralized
- `lib/validation.ts` validates all DTOs from the Rust backend at runtime
- `features/vault/` renders `GroupTree` + `EntryList` with client-side navigation, entry editing, and save flow
- `features/sync/` renders sync configuration, provider setup, and conflict resolution UI
- `features/browser/` renders browser connection approval dialog
- `features/mobile/` renders Android-specific vault, autofill, and security lifecycle UI
- Strict TypeScript: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`

**Secret boundary:**
- `SecretString`, `KdbxDocument`, and `VaultSession` cannot derive `Serialize`
- IPC DTOs carry `passwordPresent: bool` and `SummaryTextDto` (protected/missing/visible) — never actual secrets
- No browser persistence (localStorage, sessionStorage, IndexedDB, cookies are forbidden)
- Password and notes plaintext cross into React only after explicit Reveal, live for at most 15 seconds, and clear on hide/lock/unmount/blur
- Copy Password and Copy Username use semantic Rust IPC commands; password plaintext is never returned to React by the copy path

**Contract testing:** A committed `contracts/desktop-contract.json` fixture is validated bidirectionally — from a Rust `#[test]` and from TypeScript Vitest — to ensure IPC serialization never silently breaks.

See [docs/ipc-surface.md](/docs/ipc-surface.md) for the full Tauri IPC security inventory and command classification.

## Three-Way Sync Engine

The three-way merge engine lives in `kdbx/src/sync.rs` and is orchestrated by the `vault-sync` crate. The higher-level sync orchestration lives in the `sync-engine` crate, which adds encrypted store management, journal-based crash recovery, and conflict authority.

See [architecture/sync-engine](/openwiki/architecture/sync-engine.md) for the full sync architecture, provider abstraction, conflict authority, and recovery model.

**Merge layer (`vault-sync`):**

```rust
pub fn merge(base, local, remote) -> Result<MergeOutcome, MergeError>
```

**Orchestration layer (`sync-engine`):**

```rust
pub fn sync(store, provider) -> Result<SyncOutcome, SyncError>
pub fn resolve(store, choice) -> Result<SyncOutcome, SyncError>
```

**`MergeOutcome` variants:**

| Variant | Meaning |
|---|---|
| `Equivalent` | Local and remote have identical semantics |
| `FastForwardLocal` | Remote still equals base; local is the successor |
| `FastForwardRemote` | Local still equals base; remote is the successor |
| `Merged(MergedDocument)` | Both diverged; all changes synthesized cleanly |
| `Conflicted(MergeConflictSet)` | Ambiguous changes detected; no merged document |

The engine clones LOCAL as a candidate, applies REMOTE's deltas using three-way choice (LOCAL==BASE → take REMOTE, REMOTE==BASE → keep LOCAL, both changed → conflict). It handles entries, groups, custom icons, metadata, tombstones, history (attachment-safe merging), and child-order preservation.

## Verified Persistence

`vault-session` owns filesystem paths and the multi-stage verified save protocol.

See [architecture/persistence](/openwiki/architecture/persistence.md) for the full save protocol, fingerprint verification, and platform limitations.

**Key types:**

| Type | Purpose |
|---|---|
| `VaultSession` | Holds path, `KdbxDocument`, `FileFingerprint`, `saved_revision` |
| `FileFingerprint` | SHA-256 + size of encrypted bytes (no `Debug`) |
| `SaveOutcome` | `Unchanged \| Saved` |

**Public API:**

| Method | Purpose |
|---|---|
| `VaultSession::open(path, credential)` | Canonicalize, reject symlinks, fingerprint |
| `projection()` | Fresh `Vault` snapshot |
| `is_dirty()` | Whether in-memory mutations exist since save |
| `save(credential)` | 16-step verified atomic persistence |
| `lock()` | Consume session, drop decrypted state |

## Architecture Invariants

These invariants are documented in `docs/architecture.md` and enforced by code structure:

1. **KDBX is the source of truth.** The domain model is a projection, not a serialization format.
2. **KeePass/KeePassXC interoperability must never break.** Loss of supported semantic data is a P0 bug.
3. **No sync server may possess vault decryption keys.**
4. **Vault decryption and conflict merge happen client-side.**
5. **UI/platform layers must not depend directly on the KDBX implementation.**
6. **KDBX-specific types must not leak outside the adapter boundary.**
7. **Sensitive values must never be intentionally written to logs.**
8. **Saving a vault must not silently discard unsupported/unknown semantic data.**
9. **Sync conflict descriptors never carry competing plaintext values.**
10. **Persistence verifies semantic equivalence at every filesystem boundary.**
11. **`#[tauri::command]` is allowed only in `apps/desktop/src-tauri/src/commands.rs`.**
12. **`keepass::` types are confined to `crates/kdbx/`.**
13. **Core crates must not depend on Tauri.**
14. **`SecretString`, `KdbxDocument`, and `VaultSession` must not derive `Serialize`.**
15. **The IPC surface carries no secrets — only `passwordPresent` booleans and protection-mode enums.**
16. **Browser credential data never enters the React layer — only opaque approval IDs and semantic DTOs.**
17. **All sync writes are compare-and-swap — no unconditional overwrite is possible.**
18. **The browser-native host is stateless — it never owns a `VaultSession` or caches credentials.**
19. **Mobile Activity-scoped authority invalidates on pause, focus loss, or generation change.**
20. **Sync gateway never parses vault contents — it stores opaque encrypted KDBX bytes only.**

## Security Design

- The CLI reads the master password via `rpassword::prompt_password` (no echo, no CLI argument).
- `SecretString` uses `zeroize::Zeroizing<String>`, clearing memory on drop; no `Debug`/`Clone`/`Display`.
- Adapter errors never embed the password or entry/group identifiers.
- The projection excludes all secret fields by design — `SecretString` values require explicit `expose_secret()`.
- `vault-session` never retains the master password; credentials are supplied per-operation.
- `vault-sync` conflict descriptors identify objects and field categories but never carry competing values.
- **Desktop IPC** exposes only `passwordPresent: bool` and `SummaryTextDto` (protected/missing/visible) — never actual secret values. The absolute file path stays in Rust; JavaScript receives only the selected filename.
- **Browser IPC** uses strict bounded protocol with `Zeroizing<String>` for credential fields; candidate and credential data never enters the React layer. Approval is explicit and session-scoped.
- **Sync** uses CAS-based conflict avoidance (`If-Match` / `If-None-Match: *`); providers return only encrypted bytes and an opaque revision. Decryption and merge happen client-side.
- **Sync Gateway** stores opaque encrypted KDBX bytes; never parses vault contents. Token auth uses constant-time comparison of SHA-256 digests.
- **Tauri capabilities** are locked to `core:default` permissions only. CSP prohibits `unsafe-eval`, wildcard sources, and arbitrary remote HTTPS origins.
- **Browser persistence** (localStorage, sessionStorage, IndexedDB, cookies) is forbidden for vault UI state.

See the [threat model](/docs/threat-model.md) for assets, assumptions, and gaps. See [write safety](/docs/write-safety.md) for persistence guarantees and platform limitations. See [quality policy](/docs/quality.md) for machine-enforced architecture and security guards. See [IPC surface](/docs/ipc-surface.md) for the full Tauri command classification. See [self-hosting](/docs/self-hosting.md) for the sync gateway deployment guide.

## Source Map

| Path | Role |
|---|---|
| `apps/cli/src/main.rs` | CLI entry point: argument parsing, password prompt, output formatting |
| `apps/desktop/src-tauri/src/commands.rs` | Tauri IPC commands: session, vault, save, sync, browser, mobile |
| `apps/desktop/src-tauri/src/commands/sync.rs` | Sync-specific IPC commands |
| `apps/desktop/src-tauri/src/state.rs` | `DesktopVaultService` managing one `VaultSession` behind `Arc<Mutex>` |
| `apps/desktop/src-tauri/src/dto.rs` | IPC DTOs: `VaultSnapshotDto`, `EntrySummaryDto`, `SummaryTextDto` |
| `apps/desktop/src-tauri/src/errors.rs` | Error types: `DesktopErrorDto` with stable error codes |
| `apps/desktop/src-tauri/src/clipboard.rs` | Clipboard management with ownership tracking |
| `apps/desktop/src-tauri/src/browser_bridge.rs` | Browser IPC bridge: listener, approval, credential flow |
| `apps/desktop/src-tauri/src/sync/mod.rs` | Sync orchestration: profiles, provider abstraction, CAS operations |
| `apps/desktop/src-tauri/src/sync/profile.rs` | Sync profile management and persistence |
| `apps/desktop/src-tauri/src/sync/provider.rs` | Provider abstraction for WebDAV, S3, Gateway |
| `apps/desktop/src-tauri/src/mobile/` | Android/iOS mobile layer: autofill, security, session, mutations |
| `apps/desktop/src/lib/desktop.ts` | Frontend IPC gateway — sole `invoke()` call site |
| `apps/desktop/src/lib/validation.ts` | Runtime contract validators for all DTOs |
| `apps/desktop/contracts/desktop-contract.json` | Bidirectional IPC contract fixture |
| `apps/browser-extension/src/` | Chromium/Firefox MV3 extension: background, content, popup, native protocol |
| `apps/browser-native-host/src/main.rs` | Native Messaging proxy: stdin/stdout relay to desktop socket |
| `apps/sync-gateway/src/server.rs` | HTTP server: CAS-based encrypted blob storage |
| `apps/sync-gateway/src/auth.rs` | Bearer token authentication (SHA-256 digest, constant-time) |
| `apps/sync-gateway/src/storage.rs` | Filesystem backend: per-vault files with exclusive lock |
| `crates/vault-core/src/lib.rs` | Domain model: `Vault`, `Group`, `EntrySummary`, `SecretString`, `SummaryText`, `CustomFieldSummary`, `NewEntry`, identifiers |
| `crates/kdbx/src/lib.rs` | KDBX adapter: open, mutations, save, verification, `KdbxError` |
| `crates/kdbx/src/sync.rs` | Three-way merge engine: conflict detection, semantic synthesis, validation |
| `crates/vault-session/src/lib.rs` | Verified persistence: `VaultSession`, atomic save, `FileFingerprint` |
| `crates/vault-session/src/fingerprint.rs` | SHA-256 file fingerprinting |
| `crates/vault-session/src/platform.rs` | Platform-specific save/replace/sync operations |
| `crates/vault-session/src/sync_persistence.rs` | Sync-specific persistence: journal, BASE management |
| `crates/vault-sync/src/lib.rs` | Merge orchestrator: `merge()`, `MergeOutcome`, `MergedDocument` |
| `crates/sync-engine/src/lib.rs` | Sync orchestration: `SyncEngine`, `SyncStore`, `ConflictAuthority`, crash recovery |
| `crates/sync-engine/src/engine.rs` | Main sync flow: recovery → load → merge → commit |
| `crates/sync-engine/src/store.rs` | Encrypted journal and CAS store with schema versioning |
| `crates/sync-engine/src/conflict_authority.rs` | Process-local conflict singleton for deferred resolution |
| `crates/sync-provider-core/src/lib.rs` | `RemoteObjectProvider` trait: `read`, `create_if_absent`, `replace_if_revision` |
| `crates/sync-provider-webdav/src/lib.rs` | WebDAV transport: conditional PUT/GET with strong ETags |
| `crates/sync-provider-s3/src/lib.rs` | AWS S3 transport: conditional PUT/GET with object metadata |
| `crates/sync-provider-gateway/src/lib.rs` | Sync Gateway client: conditional CAS over HTTP |
| `crates/sync-gateway-protocol/src/lib.rs` | Wire-format invariants: token bounds, validation |
| `crates/browser-native-protocol/src/lib.rs` | Strict bounded IPC protocol: framing, message types, validation |
| `crates/credential-provider-core/src/lib.rs` | Platform-neutral credential matching: application/web, service, origin |
| `Makefile` | Single developer/CI interface for all quality gates |
| `Cargo.toml` | Workspace definition, shared dependencies, lints |
| `VERSION` | Pinned semantic version string |
| `docs/quality.md` | Quality, security, and architecture policy |
| `docs/architecture.md` | Architecture invariants and compatibility boundary |
| `docs/kdbx-compatibility.md` | KDBX format compatibility matrix |
| `docs/write-safety.md` | Persistence guarantees and platform limitations |
| `docs/threat-model.md` | Threat model, assets, assumptions, gaps |
| `docs/self-hosting.md` | Sync Gateway self-hosting guide |
| `docs/ipc-surface.md` | Tauri IPC security inventory and command classification |
| `docs/release.md` | Release process and engineering |
| `docs/security-audit-m8.md` | M8 security audit checklist |
| `fixtures/kdbx/` | 4 synthetic test databases with provenance documentation |
| `scripts/check_architecture.mjs` | Architecture guard: line budgets, dependency boundaries, IPC single-gateway |
| `scripts/check_security.mjs` | Security guard: forbids secrets in IPC, browser persistence, dangerous DOM APIs |
| `scripts/check_docs.mjs` | Docs guard: required files and canonical patterns |
| `scripts/check_diff_coverage.mjs` | Changed-line coverage ratcheting for Rust and TypeScript |
| `scripts/check_sync.mjs` | Sync guard: provider trait boundaries, recovery invariants |
| `scripts/check_gateway.mjs` | Gateway guard: source policy, auth, CAS operations |
| `scripts/check_browser_extension.mjs` | Browser extension guard: permissions, manifest, build artifacts |
| `scripts/check_browser_native_host.mjs` | Native host guard: installer, proxy, transaction safety |
| `scripts/check_release_source.mjs` | Release source validation |
| `scripts/release_artifacts.mjs` | Release artifact management |
