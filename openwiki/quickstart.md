---
type: Quickstart
title: Nian Pass — Quickstart
description: Entry point for understanding Nian Pass, an experimental KDBX-native password manager foundation in Rust, with links to architecture, testing, and operations.
tags: [quickstart, navigation, overview]
---

# Nian Pass — Quickstart

Nian Pass is an **experimental, KDBX-native password manager** focused on KeePass and KeePassXC interoperability. It is written in Rust and organized as a Cargo workspace.

> **Status:** Early development (M3.5 milestone). Do not use with production credentials.

## Principles

- **KDBX-native** — the `.kdbx` file is the source of truth
- **Offline-first** — no network dependency for vault operations
- **Zero-knowledge** — sync servers must never see decryption keys
- **KeePass/KeePassXC interoperability** — must never break KeePass compatibility
- **Bring your own cloud** — users choose their own sync backend

## Current Milestone: M3.5 — Conflict-safe Sync Engine

The workspace provides:

- A KDBX-independent domain model with secret handling ([`vault-core`](/openwiki/architecture/overview.md))
- A KDBX adapter with read, mutation, save, and three-way merge ([`kdbx`](/openwiki/architecture/overview.md))
- A local unlocked vault session with verified persistence ([`vault-session`](/openwiki/architecture/overview.md))
- A provider-independent three-way semantic merge orchestrator ([`vault-sync`](/openwiki/architecture/overview.md))
- A CLI for metadata inspection ([`nian-pass`](/openwiki/architecture/overview.md))
- Four checked-in [fixtures](/openwiki/testing.md) proving read compatibility across KDBX 3.1, 4.0, and 4.1

## Quick Start

```bash
# Open a KDBX database and show group/entry counts
cargo run -p nian-pass-cli -- info path/to/database.kdbx

# List group names and entry titles (tree view)
cargo run -p nian-pass-cli -- list path/to/database.kdbx
```

Both commands prompt for the master password interactively. There is no `--password` flag — this is a deliberate security choice.

## Workspace Layout

```text
nian-pass/
├── apps/cli/          nian-pass CLI binary
├── crates/
│   ├── vault-core/    KDBX-independent domain model + secret types
│   ├── kdbx/          KDBX adapter (keepass-rs boundary, mutations, sync)
│   ├── vault-session/ Local session with verified atomic persistence
│   └── vault-sync/    Provider-independent three-way merge orchestrator
├── fixtures/kdbx/     Synthetic test databases (4 fixtures)
├── docs/              Architecture, threat model, compatibility, write safety
└── .forgejo/workflows/ CI quality checks (Rust, Windows cross-check, KeePassXC compat)
```

See [architecture/overview](/openwiki/architecture/overview.md) for how the crates depend on each other and why.

## Navigation

| Topic | Page |
|---|---|
| Architecture, domain model, crate dependency, invariants | [architecture/overview](/openwiki/architecture/overview.md) |
| Three-way sync engine, merge model, conflict types | [architecture/sync-engine](/openwiki/architecture/sync-engine.md) |
| Verified persistence, save protocol, platform limits | [architecture/persistence](/openwiki/architecture/persistence.md) |
| Test suite, fixtures, CI pipeline | [testing](/openwiki/testing.md) |

## Development Commands

```bash
# Verify fixture integrity
sha256sum --check fixtures/kdbx/SHA256SUMS

# Format check
cargo fmt --check

# Lint (warnings are errors)
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings

# Run all tests
cargo test --locked --workspace

# KeePassXC external compatibility (skips if keepassxc-cli absent)
scripts/test-keepassxc-compat.sh
```

## Known Gaps (M3.5)

- No UI, cloud transport, or provider integration
- No clipboard protection, locked-memory allocation, or process hardening
- No keyfile or hardware key support
- Windows save persistence disabled pending safe-Rust DACL-preserving replacement
- No product-level recycle-bin, notes editing, TOTP, attachment/icon UI, or history restore
- KDBX 3.1 and 4.0 writing deliberately rejected (not upgraded or rewritten)

## Backlog

- **Clipboard and memory hardening** — critical for production use
- **Extended KDBX feature coverage** — key files, key-provider plugins, custom data
- **Windows persistence** — safe DACL-preserving write implementation
- **UI and cloud transport** — future milestones
