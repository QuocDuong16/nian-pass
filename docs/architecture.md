# Architecture

Nian Pass is a KDBX-native, offline-first password manager. The `.kdbx` file is
the source of truth. M1 retains the established read path and introduces an
experimental KDBX 4.1 write foundation without an in-place filesystem save or
synchronization layer.

## Dependency direction

```text
CLI
 ├── kdbx
 └── vault-core

kdbx
 ├── keepass-rs
 └── vault-core

vault-core
 └── no KDBX dependency
```

`vault-core` owns KDBX-independent domain types. `crates/kdbx` is the adapter
that contains all `keepass-rs` types and converts them to the domain model. The
CLI consumes only the adapter's public API and `vault-core` values. No
`keepass-rs` type crosses the adapter's public boundary.

The adapter's read API returns an `OpenedVault` containing the `Vault`
projection and a dependency-neutral `KdbxVersion`. The version preserves the
exact major/minor header value, so the CLI can report `3.1`, `4.0`, or `4.1`
without exposing a `keepass-rs` enum.

The M0.5 domain model is intentionally a credential-free, read-only projection.
It contains group names, entry titles, and identifiers, but not passwords,
notes, TOTP seeds, attachments, history, or custom fields. The included values
are non-secret vault metadata, but they remain privacy-sensitive and must not be
logged or sent to telemetry by default. It is not a serialization model. A
future write design must preserve semantics that Nian Pass does not edit or
understand; reconstructing a database from this projection is forbidden.

For edits, `KdbxDocument` privately owns the complete parsed
`keepass::Database`. Callers may request a fresh `Vault` projection, but title
mutation and serialization operate on the retained complete database, never on
that projection:

```text
vault-core presentation
          ^
          | projection
    KdbxDocument
  complete opaque state
          |
      keepass-rs
```

M1 exposes one mutation: rename an entry title by stable `EntryId`. It uses the
pinned upstream change-tracking API only when the visible value changes. A real
rename preserves the title field's protected/unprotected mode, stores the prior
entry state in history, and updates `LastModificationTime`; a same-value request
does none of those things. The document never stores the master password;
credentials are supplied again when saving. Its writer-first API cannot open or
overwrite a path.

The pinned writer only accepts exact KDBX 4.1. The adapter therefore returns
`UnsupportedWriteFormat` for KDBX 3.1 and 4.0 and performs no silent format,
KDF, cipher, or compression migration.

## Architecture Invariants

1. **KDBX is the source of truth.**
2. **Nian Pass must preserve interoperability with KeePass and KeePassXC.**
3. **No sync server may possess vault decryption keys.**
4. **Vault decryption and conflict merge happen client-side.**
5. **UI/platform layers must not depend directly on the KDBX implementation.**
6. **KDBX-specific types must not leak outside the KDBX adapter boundary unless explicitly justified.**
7. **Secret material and privacy-sensitive vault metadata must not be written to logs, telemetry, crash reports, or remote diagnostics by default.**
8. **Saving a vault must not silently discard unsupported/unknown semantic data.**
9. **A KDBX file must never be reconstructed from an incomplete presentation projection.**
10. **Unsupported semantics must be preserved by retaining the complete parsed database representation whenever the underlying library supports it.**
11. **A mutation must not change unrelated field semantics, including protected/unprotected state, unless explicitly requested.**

If Nian Pass saves a database that KeePassXC can no longer open, or silently
loses supported semantic data, treat it as a P0 compatibility bug.

## Current compatibility boundary

M0.5 opens local files through `keepass-rs` and maps credential-free vault
metadata into `vault-core`. Trusted fixtures verify specific KDBX 3.1, 4.0,
and 4.1 combinations; the exact evidence and untested dimensions are recorded
in [the compatibility matrix](kdbx-compatibility.md). Format-level verification
is not evidence of complete feature compatibility for that format.

M1 proves a KDBX 4.1 Nian Pass self-roundtrip for the trusted KeePassXC 2.7.12
fixture. The test compares version, KDF, ciphers, compression, group and entry
structure, identifiers, titles, history/timestamp behavior, and equality of the
complete representation parsed by `keepass-rs`. This does not prove preservation
of data that the dependency does not parse, byte-for-byte stability, or that
KeePassXC can open Nian Pass output. External compatibility and atomic
filesystem replacement remain later milestones.
