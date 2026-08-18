# Architecture

Nian Pass is a KDBX-native, offline-first password manager. The `.kdbx` file is
the source of truth. M2 adds secure, application-facing read/edit APIs to the
M1.5 preservation architecture without an in-place filesystem save,
presentation layer, or synchronization layer.

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

The M2 domain model separates bulk metadata from explicit secret access:

- `EntrySummary` contains an identifier, title, optional username and URL,
  tags, and password/notes presence flags. Absence remains distinct from an
  explicitly empty username or URL. It never contains password or notes
  plaintext, TOTP data, attachments, or custom-field values.
- `SecretString` owns one explicitly requested password or notes value in a
  zeroizing buffer. It has no `Debug`, `Display`, `Clone`, serialization, deref,
  or implicit string-borrowing implementation; plaintext access requires
  `expose_secret()`.
- `Vault` and `Group` remain secret-free list/navigation projections. Their
  metadata is privacy-sensitive and must not be logged or sent to telemetry by
  default.

The projection is not a serialization model. Reconstructing a KDBX database
from it is forbidden because doing so would discard semantics Nian Pass does
not expose or understand.

`KdbxDocument` privately owns the complete decrypted KDBX state represented by
`keepass::Database`. `keepass-rs` remains only the parser/writer implementation
behind the adapter. Callers may request a fresh `Vault` projection or one
explicit password/notes value, but mutations and serialization operate on the
retained complete database, never on the projection:

```text
vault-core presentation
          ^
          | projection
    KdbxDocument
  complete opaque state
          |
      keepass-rs
```

M2 exposes only title, username, URL, and password mutation by stable `EntryId`.
A private adapter helper applies one common policy: compare plaintext before
tracking, preserve an existing field's protected/unprotected mode, append one
history item and update `LastModificationTime` only for a real change, and make
same-value or missing-plus-empty requests complete no-ops. Missing Title,
UserName, and URL fields are created unprotected; a missing Password is created
protected. These defaults match KeePass memory-protection defaults, and the
password default is security-critical. URLs are stored verbatim without browser
normalization.

The document never stores the master password; credentials are supplied again
when saving. Its writer-first API cannot open or overwrite a path.

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
12. **Secret-bearing fields must be fetched explicitly and must not be included in bulk vault projections.**
13. **Public mutation APIs must preserve an existing KDBX field's protection mode unless an API explicitly represents a protection-mode change.**

If Nian Pass saves a database that KeePassXC can no longer open, or silently
loses supported semantic data, treat it as a P0 compatibility bug.

## Current compatibility boundary

M2 opens local files through `keepass-rs` and maps secret-free vault metadata
into `vault-core`. Trusted fixtures verify specific KDBX 3.1, 4.0,
and 4.1 combinations; the exact evidence and untested dimensions are recorded
in [the compatibility matrix](kdbx-compatibility.md). Format-level verification
is not evidence of complete feature compatibility for that format.

M1 proves a KDBX 4.1 Nian Pass self-roundtrip for the trusted KeePassXC 2.7.12
fixture. M1.5 separately uses a released `keepassxc-cli` as an independent
implementation: Nian Pass mutates and writes a temporary copy, KeePassXC opens
and lists it, KeePassXC performs a second explicit title mutation and resave,
and Nian Pass reopens and compares the result. Self-roundtrip evidence is not
external interoperability evidence, and neither form proves preservation of
data the dependency does not parse or byte-for-byte ciphertext stability.

KeePassXC is test tooling only. It is not a library, runtime, or deployment
dependency of Nian Pass. The external harness writes only inside an isolated
temporary directory through the existing caller-owned writer API; no public
save-to-path API is introduced. Atomic filesystem replacement remains a later
milestone. M2 self-roundtrip tests extend the evidence to username, URL, and
password mutation, including protection/history preservation; the external
suite still proves only its existing title-mutation pipeline.
