---
type: Architecture Overview
title: Nian Pass — Architecture
description: Workspace structure, crate dependency direction, domain model, architecture invariants, security boundaries, and KDBX adapter design for Nian Pass.
tags: [architecture, domain-model, design, security]
---

# Architecture Overview

Nian Pass is a KDBX-native, offline-first password manager. The `.kdbx` file is the source of truth; the M0 codebase provides a read-only foundation and does not implement saving or synchronization.

## Dependency Direction

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart TD
    CLI["nian-pass CLI<br/>apps/cli"]
    VC["vault-core<br/>crates/vault-core"]
    KDBX["KDBX adapter<br/>crates/kdbx"]
    KEEPASS["keepass-rs<br/>(external crate)"]

    CLI --> KDBX
    CLI --> VC
    KDBX --> VC
    KDBX --> KEEPASS

    style VC fill:#e8f5e9,stroke:#2e7d32
    style KDBX fill:#e3f2fd,stroke:#1565c0
    style KEEPASS fill:#fff3e0,stroke:#e65100
    style CLI fill:#fce4ec,stroke:#c62828
```

- **`vault-core`** owns KDBX-independent domain types. It has no dependency on any KDBX library.
- **`crates/kdbx`** is the adapter that contains all `keepass-rs` types and converts them to the domain model. `keepass` types are intentionally confined to this crate's private implementation.
- **`apps/cli`** consumes only the adapter's public API and `vault-core` values. It never imports `keepass` directly.
- Future UI/platform clients will depend on `vault-core`, never on the KDBX adapter.

## Domain Model

The M0 domain model is a **non-sensitive, read-only projection** of an opened vault. It contains group names and entry titles, but intentionally excludes passwords, notes, TOTP secrets, attachments, history, and custom fields.

### Core Types (`vault-core`)

| Type | Purpose |
|---|---|
| `Vault` | Read-only view of an opened vault. Wraps the root `Group`. |
| `Group` | A named vault group with child groups and entries. Supports recursive `find_group` by `GroupId`. |
| `Entry` | A non-sensitive entry projection containing only `id` and `title`. |
| `GroupId` | Stable group identifier copied across the adapter boundary. |
| `EntryId` | Stable entry identifier copied across the adapter boundary. |

**Key design decisions:**

- `Vault`, `Group`, and `Entry` do **not** implement `Debug`, preventing accidental bulk dumps of vault data to logs or error messages.
- `GroupId` and `EntryId` are opaque string wrappers — their format depends on the KDBX adapter and must not be assumed.
- `group_count()` and `entry_count()` are O(n) recursive traversals. The domain model has no caching or indexing.

### KDBX Adapter (`kdbx`)

The adapter exposes a single public function:

```rust
pub fn open(path: impl AsRef<Path>, master_password: &str) -> Result<Vault, KdbxError>
```

**Error variants** (`KdbxError`):

| Variant | Meaning |
|---|---|
| `Io` | Database file could not be read |
| `InvalidKdbx` | Truncated, malformed, or not a KDBX file |
| `InvalidCredentials` | Master password rejected |
| `UnsupportedFormat` | KDBX format or feature not supported by this adapter |
| `Conversion` | Valid database could not be represented by the domain model |

The error type is `#[non_exhaustive]`, allowing new variants without breaking callers.

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

## Security Design

- The CLI reads the master password via `rpassword::prompt_password` (no echo, no CLI argument).
- The password buffer uses `zeroize::Zeroizing<String>`, which clears memory on drop.
- Adapter errors (`InvalidCredentials`, `InvalidKdbx`) never embed the password.
- The M0 projection excludes all sensitive fields by design — they do not exist in the domain model.

See the [threat model](/docs/threat-model.md) for assets, assumptions, and M0 gaps.

## Source Map

| Path | Role |
|---|---|
| `apps/cli/src/main.rs` | CLI entry point: argument parsing, password prompt, output formatting, `terminal_safe` sanitization |
| `crates/vault-core/src/lib.rs` | Domain model: `Vault`, `Group`, `Entry`, `GroupId`, `EntryId` |
| `crates/kdbx/src/lib.rs` | KDBX adapter: `open()`, `KdbxError`, `convert_database`, `convert_group` |
| `Cargo.toml` | Workspace definition, shared dependencies, lints |
| `docs/architecture.md` | Architecture invariants and compatibility boundary |
| `docs/threat-model.md` | Threat model skeleton, assets, assumptions, M0 gaps |
| `fixtures/kdbx/` | Synthetic test databases and provenance documentation |
