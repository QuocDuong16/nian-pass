---
type: Reference
title: Nian Pass — Testing
description: Test suite structure, fixture policy, CI pipeline, and testing guidance for Nian Pass across all four crates.
tags: [testing, ci, fixtures, quality, merge-tests]
---

# Testing

## Running Tests

```bash
# Verify fixture integrity first
sha256sum --check fixtures/kdbx/SHA256SUMS

# Run all tests
cargo test --locked --workspace

# KeePassXC external compatibility (skips if keepassxc-cli absent)
scripts/test-keepassxc-compat.sh
```

## Test Coverage by Crate

### `vault-core`

Tests in `crates/vault-core/src/lib.rs` validate the domain model in isolation:

- Constructing a vault with nested groups and entries
- Recursive `find_group` and `find_entry` by stable identifier
- `group_count()` includes root group
- `entry_count()` counts recursively
- `EntrySummary` exposes `id()`, `title()`, `username()`, `url()`, `tags()`, `has_password()`, `has_notes()`
- `SummaryText` variants: `Missing`, `Visible`, `Protected`
- `SecretString` compile-fail tests: no `Clone`, `Display`, `Debug`, or implicit `&str` conversion

These tests use a synthetic `sample_vault()` — no KDBX files involved.

### `kdbx` Adapter

Tests in `crates/kdbx/src/lib.rs` validate KDBX read/write compatibility:

- Opens real fixtures (KDBX 3.1, 4.0, 4.1) with correct passwords
- Rejects wrong passwords with `InvalidCredentials`
- Rejects non-KDBX files with `InvalidKdbx`
- Verifies group names, entry titles, IDs, and tree structure match expected values
- Entry mutation round-trips: title, username, URL, password (preserving protection mode)
- Entry creation, permanent deletion (tombstone), and move
- Group creation, rename, move, and permanent deletion (with root/cycle validation)
- Custom field listing, fetch, set, and delete
- KDBX 4.1 save + reopen + `verify_semantic_equivalence` round-trip
- Entry title mutation preserving protection mode

### `vault-session`

Tests in `crates/vault-session/src/lib.rs` validate verified persistence:

- Open, projection, dirty tracking, and lock lifecycle
- Save produces identical reopened semantics
- Fingerprint verification at open and save boundaries
- Symlink and non-regular file rejection
- Credential mismatch detection
- Platform-specific save behavior

### `vault-sync`

Integration tests in `crates/vault-sync/tests/merge.rs` cover the three-way merge engine:

- Fast-forward in both directions (local-ahead, remote-ahead)
- Version mismatch rejection
- Identical changes → equivalent outcome
- Independent field edits merging cleanly
- Divergent password changes → conflict
- Delete-vs-modify conflicts
- Concurrent deletes
- Move + field merge
- Move-vs-move conflicts
- Custom fields + protection conflicts
- Concurrent entry creation ordering
- Group rename + child edit merging
- Group move + rename merging
- Group delete vs descendant edit → conflict
- Group delete vs new descendant → conflict
- Concurrent group move cycle detection
- Reorder-detection tests

All merged candidates are round-tripped through serialize → reopen → `verify_semantic_equivalence`.

### `nian-pass` CLI

Tests in `apps/cli/src/main.rs` validate argument parsing and output safety:

- Parses `info` subcommand with a file path (no password argument)
- Rejects a `--password` argument (security enforcement)
- `terminal_safe()` replaces control characters with the Unicode replacement character

## Fixture Policy

All test databases live in `fixtures/kdbx/`. The policy (documented in `fixtures/kdbx/README.md`):

- **Never** commit a real vault with production credentials
- Every committed database must use **synthetic, public test data** only
- Test master passwords may be public
- Record tool version, format, password, provenance, and checksum for every fixture
- Verify checked-in hashes with `sha256sum --check fixtures/kdbx/SHA256SUMS`

### Current Fixtures

| File | Format | KDF | Cipher | Password | Source |
|---|---|---|---|---|---|
| `keepass-upstream-kdbx31-aeskdf-aes.kdbx` | KDBX 3.1 | AES-KDF | AES-256 | `demopass` | keepass-rs upstream test suite |
| `keepassxc-upstream-kdbx40-argon2d-aes.kdbx` | KDBX 4.0 | Argon2d | AES-256 | `demopass` | keepass-rs upstream test suite |
| `keepassxc-upstream-kdbx40-argon2id-chacha20.kdbx` | KDBX 4.0 | Argon2id | ChaCha20 | `demopass` | keepass-rs upstream test suite |
| `keepassxc-2.7.12-kdbx41.kdbx` | KDBX 4.1 | AES-KDF | AES-256 | `demopass` | keepass-rs upstream (KeePassXC 2.7.12) |

All fixtures are from `keepass-rs` commit `2f1dd5e0f1a23dc7420c3fa25f434fe362729b24`. The KDBX 4.1 fixture is also used for self-roundtrip and external KeePassXC round-trip tests.

## CI Pipeline

The Forgejo workflow `.forgejo/workflows/quality.yml` runs on every push and pull request with three jobs:

### Job 1: `rust`

1. **Fixture integrity** — `sha256sum --check fixtures/kdbx/SHA256SUMS`
2. **Format check** — `cargo fmt --check`
3. **Clippy lint** — `cargo clippy --locked --workspace --all-targets --all-features -- -D warnings`
4. **Tests** — `cargo test --locked --workspace`

### Job 2: `windows-cross-check`

- Compiles for `x86_64-pc-windows-msvc` target to catch platform-specific compilation issues
- Does not run tests (cross-compiled binary)

### Job 3: `keepassxc-compat`

- Installs pinned KeePassXC 2.7.4 from Debian Bookworm packages
- Runs `scripts/test-keepassxc-compat.sh --require` (missing binary is a failure, not a skip)
- Tests KDBX round-trip and vault-sync merge output against external KeePassXC

Runs in a `rust:1.97.1-bookworm` Docker container with pinned Node.js 24.19.0 and a 20-minute timeout.

## KeePassXC Compatibility Script

`scripts/test-keepassxc-compat.sh` runs two ignored tests against the external `keepassxc-cli` binary:

1. **KDBX round-trip**: Open fixture → save via Nian Pass → open via KeePassXC CLI → verify no errors
2. **Merge output**: Open three generations → merge via vault-sync → save → verify KeePassXC can open the result

The script skips clearly when `keepassxc-cli` is absent locally. Use `--require` in CI to make absence a failure.

## Testing Guidance for Future Contributors

### When adding new domain types to `vault-core`

- Add unit tests in the same file using the existing `sample_vault()` pattern
- Types must not implement `Debug` if they could contain sensitive data
- Add compile-fail tests for types that must not implement `Clone`, `Display`, or `Debug`

### When extending the KDBX adapter

- Add a fixture for each new KDBX feature you support, following the fixture policy
- Test both success and error paths (wrong password, invalid file, unsupported format)
- Verify the domain projection does not leak `keepass` types
- Test mutation round-trips: mutate → save → reopen → verify equivalence

### When adding sync/merge features

- Test both fast-forward and full three-way synthesis paths
- Verify conflict descriptors carry no plaintext values
- Add integration tests in `vault-sync/tests/merge.rs`
- All merged candidates must pass serialize → reopen → `verify_semantic_equivalence`

### When adding persistence features

- Test the full save protocol including fingerprint verification
- Test failure modes: tampered source, credential mismatch, verification failure
- Verify backup is created and committed correctly

### When adding CLI commands

- Verify no password argument is accepted (add a test like `rejects_password_argument`)
- Verify control characters in vault data are sanitized before output
- Test the `Cli` parser, not the vault-opening logic (that belongs in `kdbx` tests)

### Workspace Lints

The workspace enforces:

- `unsafe_code = "forbid"` — no unsafe Rust anywhere
- `clippy::dbg_macro = "deny"` — no `dbg!()` in committed code
- All Clippy warnings are treated as errors in CI
