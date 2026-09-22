---
type: Quickstart
title: Nian Pass — Quickstart
description: Entry point for understanding Nian Pass, an experimental KDBX-native password manager with Tauri desktop app, Rust backend, and machine-enforced quality policy.
tags: [quickstart, navigation, overview]
---

# Nian Pass — Quickstart

Nian Pass is an **experimental, KDBX-native password manager** focused on KeePass and KeePassXC interoperability. It is written in Rust (core libraries) with a Tauri 2 desktop application, and organized as a Cargo + pnpm workspace.

> **Status:** Early development (M4.Q milestone). Do not use with production credentials.

## Principles

- **KDBX-native** — the `.kdbx` file is the source of truth
- **Offline-first** — no network dependency for vault operations
- **Zero-knowledge** — sync servers must never see decryption keys
- **KeePass/KeePassXC interoperability** — must never break KeePass compatibility
- **Bring your own cloud** — users choose their own sync backend

## Current Milestone: M4.Q — Quality, Security & Architecture Gates

M4.Q adds machine-enforced repository policy on top of the product functionality from M4.0 (Desktop Shell) and M4.1 (Unlock/Browse Vault). The root `Makefile` is the single developer/CI interface for formatting, linting, tests, coverage, architecture/security invariants, contract drift, and docs.

The workspace provides:

- A KDBX-independent domain model with secret handling ([`vault-core`](/openwiki/architecture/overview.md))
- A KDBX adapter with read, mutation, save, and three-way merge ([`kdbx`](/openwiki/architecture/overview.md))
- A local unlocked vault session with verified persistence ([`vault-session`](/openwiki/architecture/overview.md))
- A provider-independent three-way semantic merge orchestrator ([`vault-sync`](/openwiki/architecture/overview.md))
- A CLI for metadata inspection ([`apps/cli`](/openwiki/architecture/overview.md))
- A Tauri 2 desktop shell with React/Vite frontend ([`apps/desktop`](/openwiki/architecture/overview.md)) — browse-only in M4.1
- Machine-enforced architecture, security, docs, and coverage guards ([`scripts/`](/openwiki/testing.md))
- Four checked-in [fixtures](/openwiki/testing.md) proving read compatibility across KDBX 3.1, 4.0, and 4.1

## Quick Start

```bash
# Full quality gate (pre-merge check)
make quality-check

# Quick feedback during development
make quick-check

# CLI usage — inspect a KDBX database
cargo run -p nian-pass-cli -- info path/to/database.kdbx
cargo run -p nian-pass-cli -- list path/to/database.kdbx
```

Both CLI commands prompt for the master password interactively. There is no `--password` flag — this is a deliberate security choice.

## Workspace Layout

```text
nian-pass/
├── apps/
│   ├── cli/                   nian-pass CLI binary
│   └── desktop/               Tauri 2 desktop shell + React frontend
│       ├── src-tauri/         Rust backend (Tauri commands, state, DTOs)
│       └── src/               React/TypeScript frontend (Vite, Vitest)
├── crates/
│   ├── vault-core/            KDBX-independent domain model + secret types
│   ├── kdbx/                  KDBX adapter (keepass-rs boundary, mutations, sync)
│   ├── vault-session/         Local session with verified atomic persistence
│   └── vault-sync/            Provider-independent three-way merge orchestrator
├── fixtures/kdbx/             Synthetic test databases (4 fixtures)
├── scripts/                   Quality guard scripts (architecture, security, coverage, docs)
├── docs/                      Architecture, threat model, quality policy, write safety
├── Makefile                   Single developer/CI interface for all quality gates
└── .forgejo/workflows/        CI quality checks (Rust, desktop, KeePassXC compat)
```

See [architecture/overview](/openwiki/architecture/overview.md) for how the crates depend on each other and why.

## Navigation

| Topic                                                    | Page                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| Architecture, domain model, crate dependency, invariants | [architecture/overview](/openwiki/architecture/overview.md)       |
| Three-way sync engine, merge model, conflict types       | [architecture/sync-engine](/openwiki/architecture/sync-engine.md) |
| Verified persistence, save protocol, platform limits     | [architecture/persistence](/openwiki/architecture/persistence.md) |
| Test suite, fixtures, CI pipeline, quality scripts       | [testing](/openwiki/testing.md)                                   |

## Development Commands

```bash
# Full quality gate (CI-equivalent)
make quality-check

# Quick feedback (format, lint, test, security, docs — no coverage)
make quick-check

# Install pinned quality tools (cargo-deny, cargo-machete, cargo-llvm-cov)
make tools-install

# Rust-only checks (format, lint, test, doc, deps, security, coverage)
make rust-check

# Desktop frontend checks (format, lint, typecheck, test, coverage, dead code, build)
make desktop-check

# Desktop native check (cargo check/test/clippy for the Tauri crate)
make desktop-native-check

# Individual Rust targets
cargo fmt --check
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
cargo test --locked --workspace

# KeePassXC external compatibility (skips if keepassxc-cli absent)
scripts/test-keepassxc-compat.sh
```

See `docs/quality.md` for the full quality policy, coverage ratchets, and dependency policy.

## Current product gaps

- Desktop supports password-only, keyfile-only, and password+keyfile unlock; hardware-key / challenge-response unlock remains unsupported
- Desktop entry-history review/restore exists for revisions without attachments or custom icons; mobile exposes on-demand secret-free history review, while attachment/icon history restore remains unsupported; mobile also exposes on-demand attachment metadata review; Android supports native SAF attachment import/export while iOS remains metadata-only
- Desktop supports native-picked PNG custom-icon replacement with 4 MiB and 4096 × 4096 bounds; favicon download and custom-icon cleanup/maintenance remain deferred
- Desktop General Settings can edit KDBX database name, description, default username, and enable/disable Trash; these are in-memory mutations until explicit Save succeeds
- Desktop bulk entry move/Trash/restore/permanent-delete exists with atomic all-or-nothing batches capped at 1024 entries; Settings can enable/disable an empty KDBX Trash policy and edit the finite per-entry history revision count, with both remaining ordinary dirty mutations that require explicit Save; serialized-history-size enforcement, Auto-Type, and passkey management remain unsupported
- Desktop and writable Android can edit bounded ordered entry tags through tracked KDBX mutations; iOS/read-only mobile exposes tags as metadata only
- Desktop TOTP configure/reveal/copy exists; writable Android mobile can configure/remove/reveal TOTP and Android Autofill can fill explicit OTP fields with an ephemeral Rust-generated code. iOS mobile remains read-only but can explicitly reveal the current code
- KDBX 3.1 and 4.0 writing remains deliberately rejected (not upgraded or rewritten)
- Some platform integrations remain deferred; see the root README and architecture docs for the reviewed support matrix

## Backlog

- **Clipboard and memory hardening** — critical for production use
- **Extended KDBX feature coverage** — hardware/key-provider plugins, custom data
- **Windows persistence** — safe DACL-preserving write implementation
- **Desktop feature expansion** — password reveal, entry editing, save UI, search, background monitoring
