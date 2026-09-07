---
type: Reference
title: Nian Pass — Testing
description: Test suite structure, fixture policy, CI pipeline, desktop testing, quality scripts, and testing guidance for Nian Pass.
tags: [testing, ci, fixtures, quality, merge-tests, desktop, vitest]
---

# Testing

## Running Tests

```bash
# Full quality gate (CI-equivalent)
make quality-check

# Quick feedback during development
make quick-check

# Rust tests only
cargo test --locked --workspace

# Desktop frontend tests only (Vitest)
make desktop-test

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

### `sync-engine`

Integration tests in `crates/sync-engine/tests/sync.rs` cover:

- Full sync lifecycle with recovery check
- Journal phase tracking and crash recovery
- Conflict authority single-use token and stale protection
- Store metadata persistence and schema validation
- Local snapshot capture and replace operations
- Error propagation from providers and merge engine

### `sync-provider-gateway`

Integration tests in `crates/sync-provider-gateway/tests/` cover:

- Gateway provider trait implementation
- Conditional create (`If-None-Match: *`) and conditional replace (`If-Match`)
- Post-write read-back confirm
- Token authentication and error handling
- HTTP transport with mock server

### `sync-gateway`

Integration tests in `apps/sync-gateway/tests/` cover:

- HTTP server endpoints: `/healthz`, `GET /v1/vaults/{uuid}`, `PUT /v1/vaults/{uuid}`
- CAS operations: create, replace, conditional reject
- Token authentication: valid, invalid, missing
- Filesystem storage: per-vault files, exclusive process lock
- Container build and Docker context validation

### `browser-native-protocol`

Tests in `crates/browser-native-protocol/src/` and `tests/` cover:

- Framing: length-prefixed JSON over stream
- IPC endpoints: `bind_desktop_listener()` / `connect_desktop()`
- Protocol constants: version, host name, bounds
- Message types: request/response serialization parity
- Validation: fail-closed on unknown fields, wrong versions, oversized content

### `credential-provider-core`

Tests in `crates/credential-provider-core/tests/` cover:

- Platform-neutral credential matching: application/web, service, origin
- Secret retrieval with bounded output
- Error handling for unmatched credentials

### `nian-pass` CLI

Tests in `apps/cli/src/main.rs` validate argument parsing and output safety:

- Parses `info` subcommand with a file path (no password argument)
- Rejects a `--password` argument (security enforcement)
- `terminal_safe()` replaces control characters with the Unicode replacement character

### `apps/desktop` (Vitest)

Frontend tests use Vitest with jsdom environment and v8 coverage provider. Tests are in `apps/desktop/src/`:

- `App.test.tsx` — top-level rendering and view switching
- `app/ApplicationRoot.test.tsx` — application root and runtime validation
- `lib/desktop.test.ts` — IPC gateway mocking and contract validation
- `lib/desktop-errors.test.ts` — error type validation
- `lib/sync-api.test.ts` — sync API contract validation
- `lib/sync.test.ts` — sync integration testing
- `lib/mobile.test.ts` — mobile API mocking
- `features/vault/` — vault entry, group, save, and dirty lifecycle tests
- `features/sync/SyncSection.test.tsx` — sync UI panel tests
- `features/sync/sync-errors.test.ts` — sync error handling
- `features/mobile/MobileVaultApp.test.tsx` — mobile vault app tests
- `features/mobile/MobileSecurityLifecycle.test.tsx` — security lifecycle tests
- `features/mobile/MobileAutofill.test.tsx` — autofill functionality tests
- `features/browser/BrowserConnectionApproval.test.tsx` — browser approval UI tests

The Tauri backend has Rust-side contract tests in `commands.rs` that validate `desktop-contract.json` serialization matches the committed fixture bidirectionally.

**Coverage thresholds** (Vitest config in `vite.config.ts`): 65% statements, 60% branches, 63% functions, 64% lines. These are ratchets and may only increase.

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

The Forgejo workflow `.forgejo/workflows/quality.yml` runs on every push, pull request, and manual dispatch with parallel jobs. A separate `.forgejo/workflows/release.yml` handles tag/manual release events.

### Job 1: `rust`

- Runs in `rust:1.97.1-bookworm`
- Installs Node.js (with SHA-256 checksum verification) for GitHub action compatibility
- Runs `make tools-install` then `make rust-core-check rust-deps-check rust-security-check`
- Core Rust checks: format, clippy, tests, doc warnings, unused dependencies, cargo-deny audit, coverage

### Job 2: `desktop-frontend`

- Runs in `node:24.19.0-bookworm`
- Activates pinned pnpm via Corepack (Node 26)
- Runs `make policy-check` (architecture, security, docs guards) then `make desktop-check`
- Desktop checks: format, ESLint (including no-eslint-disable), typecheck, Vitest tests, coverage, dead code (Knip), contract validation, build, `pnpm audit` with retry
- Resolves diff coverage base from PR context for changed-line coverage ratcheting

### Job 3: `desktop-native-check`

- Runs in `rust:1.97.1-bookworm` with Tauri headless prerequisites (libwebkit2gtk, libayatana-appindicator, librsvg)
- Runs `make desktop-native-check` (cargo check/test/clippy/doc for the Tauri crate)
- Runs `make rust-coverage rust-coverage-check` plus diff coverage

### Job 4: `windows-cross-check`

- Runs in `rust:1.97.1-bookworm` with `gcc-mingw-w64-x86-64`
- Cross-compiles `vault-session` and `vault-sync` for `x86_64-pc-windows-gnu`
- Does not run tests (cross-compiled binary)

### Job 5: `keepassxc-compat`

- Runs in `rust:1.97.1-bookworm`
- Installs pinned KeePassXC 2.7.4 from Debian Bookworm packages
- Runs `make fixture-check compat-check-required` (missing binary is a failure, not a skip)
- Tests KDBX round-trip and vault-sync merge output against external KeePassXC

### Release Workflow

The dedicated release workflow (`.forgejo/workflows/release.yml`) runs only for `v*` tags or manual release events:

- Clean-tree and tag consistency validation
- Pinned release inputs and `VERSION` file checks
- Deterministic browser and Native Messaging packages
- Linux, Android, and gateway production build paths
- SHA-256 checksums, SBOM/provenance output
- Artifact regression scanning
- Tag/manual-only Forgejo release creation

## KeePassXC Compatibility Script

`scripts/test-keepassxc-compat.sh` runs two ignored tests against the external `keepassxc-cli` binary:

1. **KDBX round-trip**: Open fixture → save via Nian Pass → open via KeePassXC CLI → verify no errors
2. **Merge output**: Open three generations → merge via vault-sync → save → verify KeePassXC can open the result

The script skips clearly when `keepassxc-cli` is absent locally. Use `--require` in CI to make absence a failure.

## Quality Guard Scripts

The `scripts/` directory contains machine-enforced repository policy guards. These are invoked by `make` targets and the CI pipeline:

| Script | Purpose | Make target |
|---|---|---|
| `check_architecture.mjs` | Line budgets, dependency boundaries, IPC single-gateway, browser persistence ban, secret type non-serialization | `architecture-check` |
| `check_security.mjs` | Forbids `console.*`, `dangerouslySetInnerHTML`, `eval`, unapproved Tauri plugins, CSP violations | `security-check` |
| `check_diff_coverage.mjs` | Computes coverage of changed lines only from LCOV + `git diff` | `rust-coverage-diff`, `desktop-coverage-diff` |
| `check_docs.mjs` | Ensures required files exist and contain canonical patterns | `docs-check` |
| `check_sync.mjs` | Sync guard: provider trait boundaries, recovery invariants | `sync-source-check` |
| `check_gateway.mjs` | Gateway guard: source policy, auth, CAS operations | `gateway-source-check` |
| `check_gateway_container.sh` | Gateway Docker build context validation | `gateway-container-check` |
| `check_browser_extension.mjs` | Browser extension guard: permissions, manifest, build artifacts | `browser-extension-check` |
| `check_browser_native_host.mjs` | Native host guard: installer, proxy, transaction safety | `browser-native-host-check` |
| `check_mobile_foundation.mjs` | Android mobile foundation validation | `mobile-foundation-check` |
| `check_ios_foundation.mjs` | iOS foundation validation (deferred) | `ios-foundation-check` |
| `check_release_source.mjs` | Release source validation | `release-source-check` |
| `check_node_licenses.mjs` | Node.js dependency license compliance | `node-license-check` |
| `release_artifacts.mjs` | Release artifact management | `release-artifact-check` |
| `stage_release.mjs` | Release staging | `release-stage` |
| `run_pnpm_audit.mjs` | pnpm audit wrapper with retry logic | `desktop-audit` |

Architecture budgets (from `scripts/architecture-budget.json`): TypeScript default 250 lines, Rust default 400 lines with grandfathered exceptions.

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

### When adding sync-engine features

- Test the full sync lifecycle including recovery check, base/remote loading, merge, and commit
- Test journal phases: Prepared → RemoteCommitted → LocalCommitted → cleanup
- Verify conflict authority single-use token and stale protection
- Test recovery replay for each journal phase
- Add integration tests in `sync-engine/tests/`

### When adding sync provider features

- Implement the `RemoteObjectProvider` trait with all three CAS operations
- Test conditional create (`If-None-Match: *`) and conditional replace (`If-Match`)
- Verify post-write read-back confirms ciphertext match
- Test error variants: `NotFound`, `Conflict`, `Unauthorized`, `Forbidden`, `Unreachable`, `TooLarge`
- Add tests in the provider crate's `tests/` directory

### When adding persistence features

- Test the full save protocol including fingerprint verification
- Test failure modes: tampered source, credential mismatch, verification failure
- Verify backup is created and committed correctly

### When adding CLI commands

- Verify no password argument is accepted (add a test like `rejects_password_argument`)
- Verify control characters in vault data are sanitized before output
- Test the `Cli` parser, not the vault-opening logic (that belongs in `kdbx` tests)

### When adding desktop features

- Update `desktop-contract.json` if the IPC serialization shape changes; the Rust and TypeScript contract tests will catch drift
- Frontend business logic goes in `src/features/` or `src/lib/`; keep IPC calls centralized in `src/lib/desktop.ts`
- Add Vitest tests for new components and utilities; mock `invoke()` calls through the `desktop.test.ts` pattern
- New Tauri commands go in `src-tauri/src/commands.rs` only — the architecture guard enforces this
- Sync commands go in `src-tauri/src/commands/sync.rs`
- Do not add new Tauri plugins without explicit approval; only `tauri-plugin-dialog` is currently allowed
- Do not use browser persistence APIs (localStorage, sessionStorage, IndexedDB, cookies) — the security guard will reject them

### When adding browser integration features

- Browser extension tests use `mock-browser.ts` and `mock-port.ts` for port mocking
- Native protocol tests verify both Rust and TypeScript serialization parity against `native-contract-v1.json`
- Test the full approval flow: Connect → ApprovalPending → Connected/Credential
- Verify credential data never enters the React layer (only `NativeResponse.credential` goes to DOM)
- Add tests in `apps/browser-extension/src/` (Vitest) and `apps/browser-native-host/tests/` (Rust)

### When adding sync gateway features

- Server tests verify CAS operations: create, replace, conditional reject
- Client tests verify provider trait implementation and post-write confirm
- Container tests verify Docker build and `.gateway.lock` exclusion
- Add tests in `apps/sync-gateway/tests/` and `crates/sync-provider-gateway/tests/`

### When adding mobile features

- Android tests verify two-phase Lock, Activity-scoped authority, and curtain management
- Mobile security lifecycle tests verify generation-based authority invalidation
- Add tests in `apps/desktop/src/features/mobile/` (Vitest) and `apps/desktop/src-tauri/gen/android/app/src/test/` (Junit)

### Workspace Lints

The workspace enforces:

- `unsafe_code = "forbid"` — no unsafe Rust anywhere
- `clippy::dbg_macro = "deny"` — no `dbg!()` in committed code
- All Clippy warnings are treated as errors in CI
