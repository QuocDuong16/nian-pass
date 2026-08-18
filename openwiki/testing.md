---
type: Reference
title: Nian Pass — Testing
description: Test suite structure, fixture policy, CI pipeline, and testing guidance for Nian Pass.
tags: [testing, ci, fixtures, quality]
---

# Testing

## Running Tests

```bash
cargo test --workspace
```

This runs unit tests in all three crates. There are no integration tests or end-to-end tests yet.

## Test Coverage by Crate

### `vault-core`

Tests in `crates/vault-core/src/lib.rs` validate the domain model in isolation:

- Constructing a vault with nested groups and entries
- Recursive `find_group` by `GroupId`
- `group_count()` includes root group
- `entry_count()` counts recursively
- `Entry` exposes only `id()` and `title()`

These tests use a synthetic `sample_vault()` — no KDBX files involved.

### `kdbx` Adapter

Tests in `crates/kdbx/src/lib.rs` validate KDBX read compatibility:

- Opens a real KeePassXC 2.7.12 KDBX 4.1 fixture with the correct password (`demopass`)
- Rejects wrong passwords with `InvalidCredentials`
- Rejects non-KDBX files with `InvalidKdbx`
- Verifies group names, entry titles, IDs, and tree structure match expected values

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

### Current Fixtures

| File | Format | Password | Source |
|---|---|---|---|
| `keepassxc-2.7.12-kdbx41.kdbx` | KDBX 4.1 | `demopass` | keepass-rs test suite (KeePassXC-generated) |

This fixture is used **only for read compatibility**. It is not evidence of lossless writing or complete KDBX 4.1 support.

## CI Pipeline

The Forgejo workflow `.forgejo/workflows/quality.yml` runs on every push and pull request:

1. **Format check** — `cargo fmt --check`
2. **Clippy lint** — `cargo clippy --workspace --all-targets --all-features -- -D warnings`
3. **Tests** — `cargo test --workspace`

Runs in a `rust:1.97.1-bookworm` Docker container with a 20-minute timeout.

## Testing Guidance for Future Contributors

### When adding new domain types to `vault-core`

- Add unit tests in the same file using the existing `sample_vault()` pattern
- Types must not implement `Debug` if they could contain sensitive data
- Test `#[must_use]` on methods that return borrowed data

### When extending the KDBX adapter

- Add a fixture for each new KDBX feature you support, following the fixture policy
- Test both success and error paths (wrong password, invalid file, unsupported format)
- Verify the domain projection does not leak `keepass` types

### When adding CLI commands

- Verify no password argument is accepted (add a test like `rejects_password_argument`)
- Verify control characters in vault data are sanitized before output
- Test the `Cli` parser, not the vault-opening logic (that belongs in `kdbx` tests)

### Workspace Lints

The workspace enforces:

- `unsafe_code = "forbid"` — no unsafe Rust anywhere
- `clippy::dbg_macro = "deny"` — no `dbg!()` in committed code
- All Clippy warnings are treated as errors in CI
