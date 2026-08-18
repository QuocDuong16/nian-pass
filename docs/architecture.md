# Architecture

Nian Pass is a KDBX-native, offline-first password manager. The `.kdbx` file is
the source of truth; the M0.5 codebase provides a read-only foundation and does
not implement saving or synchronization.

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

The adapter returns an `OpenedVault` containing the `Vault` projection and a
dependency-neutral `KdbxVersion`. The version preserves the exact major/minor
header value, so the CLI can report `3.1`, `4.0`, or `4.1` without exposing a
`keepass-rs` enum.

The M0.5 domain model is intentionally a credential-free, read-only projection.
It contains group names, entry titles, and identifiers, but not passwords,
notes, TOTP seeds, attachments, history, or custom fields. The included values
are non-secret vault metadata, but they remain privacy-sensitive and must not be
logged or sent to telemetry by default. It is not a serialization model. A
future write design must preserve semantics that Nian Pass does not edit or
understand; reconstructing a database from this projection is forbidden.

## Architecture Invariants

1. **KDBX is the source of truth.**
2. **Nian Pass must preserve interoperability with KeePass and KeePassXC.**
3. **No sync server may possess vault decryption keys.**
4. **Vault decryption and conflict merge happen client-side.**
5. **UI/platform layers must not depend directly on the KDBX implementation.**
6. **KDBX-specific types must not leak outside the KDBX adapter boundary unless explicitly justified.**
7. **Secret material and privacy-sensitive vault metadata must not be written to logs, telemetry, crash reports, or remote diagnostics by default.**
8. **Saving a vault must not silently discard unsupported/unknown semantic data.**

If Nian Pass saves a database that KeePassXC can no longer open, or silently
loses supported semantic data, treat it as a P0 compatibility bug.

## Current compatibility boundary

M0.5 opens local files through `keepass-rs` and maps credential-free vault
metadata into `vault-core`. Trusted fixtures verify specific KDBX 3.1, 4.0,
and 4.1 combinations; the exact evidence and untested dimensions are recorded
in [the compatibility matrix](kdbx-compatibility.md). Format-level verification
is not evidence of complete feature compatibility for that format.

Writing, merge behavior, and lossless round trips remain deliberately
unimplemented. Those capabilities require compatibility tests against external
KeePass implementations before they can be considered safe.
