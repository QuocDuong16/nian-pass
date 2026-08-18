# Architecture

Nian Pass is a KDBX-native, offline-first password manager. The `.kdbx` file is
the source of truth; the M0 codebase provides a read-only foundation and does
not implement saving or synchronization.

## Dependency direction

```text
future UI / platform clients
             |
             v
         vault-core
             ^
             |
       KDBX adapter
             |
             v
        keepass-rs
```

`vault-core` owns KDBX-independent domain types. `crates/kdbx` is the adapter
that contains all `keepass-rs` types and converts them to the domain model. The
CLI consumes only the adapter's public API and `vault-core` values.

The M0 domain model is intentionally a non-sensitive, read-only projection. It
contains group names and entry titles, but not passwords, notes, TOTP secrets,
attachments, history, or custom fields. It is not a serialization model. A
future write design must preserve semantics that Nian Pass does not edit or
understand; reconstructing a database from this M0 projection is forbidden.

## Architecture Invariants

1. **KDBX is the source of truth.**
2. **Nian Pass must preserve interoperability with KeePass and KeePassXC.**
3. **No sync server may possess vault decryption keys.**
4. **Vault decryption and conflict merge happen client-side.**
5. **UI/platform layers must not depend directly on the KDBX implementation.**
6. **KDBX-specific types must not leak outside the KDBX adapter boundary unless explicitly justified.**
7. **Sensitive values must never be intentionally written to logs.**
8. **Saving a vault must not silently discard unsupported/unknown semantic data.**

If Nian Pass saves a database that KeePassXC can no longer open, or silently
loses supported semantic data, treat it as a P0 compatibility bug.

## Current compatibility boundary

M0 opens local files through `keepass-rs` and maps non-sensitive presentation
data into `vault-core`. The checked-in fixture proves one real KeePassXC 2.7.12
KDBX 4.1 file can be opened with its known test password. This is not evidence
of complete KDBX 3.1, 4.0, or 4.1 feature compatibility.

Writing, merge behavior, and lossless round trips remain deliberately
unimplemented. Those capabilities require compatibility tests against external
KeePass implementations before they can be considered safe.

