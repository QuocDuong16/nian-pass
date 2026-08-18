---
type: Quickstart
title: Nian Pass — Quickstart
description: Entry point for understanding Nian Pass, an experimental KDBX-native password manager foundation in Rust, with links to architecture, testing, and operations.
tags: [quickstart, navigation, overview]
---

# Nian Pass — Quickstart

Nian Pass is an **experimental, KDBX-native password manager** focused on KeePass and KeePassXC interoperability. It is written in Rust and organized as a Cargo workspace.

> **Status:** Early development (M0 milestone). Do not use with production credentials.

## Principles

- **KDBX-native** — the `.kdbx` file is the source of truth
- **Offline-first** — no network dependency for vault operations
- **Zero-knowledge** — sync servers must never see decryption keys
- **KeePass/KeePassXC interoperability** — must never break KeePass compatibility
- **Bring your own cloud** — users choose their own sync backend

## Current Milestone: M0 — KDBX Foundation

The codebase provides a **read-only** foundation:

- A KDBX-independent domain model ([`vault-core`](/openwiki/architecture/overview.md))
- A read-only [`keepass-rs`](https://crates.io/crates/keepass) adapter ([`kdbx`](/openwiki/architecture/overview.md))
- A CLI for non-sensitive metadata inspection ([`nian-pass`](/openwiki/architecture/overview.md))
- A checked-in [fixture policy](/openwiki/testing.md) proving one real KeePassXC KDBX 4.1 file can be opened

Saving and sync are **intentionally not implemented**.

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
│   ├── vault-core/    KDBX-independent domain model
│   └── kdbx/          KDBX adapter (keepass-rs boundary)
├── fixtures/kdbx/     Synthetic test databases
├── docs/              Architecture and threat model
└── .forgejo/workflows/ CI quality checks
```

See [architecture/overview](/openwiki/architecture/overview.md) for how the crates depend on each other and why.

## Navigation

| Topic | Page |
|---|---|
| Architecture, domain model, invariants | [architecture/overview](/openwiki/architecture/overview.md) |
| Test suite, fixtures, CI pipeline | [testing](/openwiki/testing.md) |

## Development Commands

```bash
# Format check
cargo fmt --check

# Lint (warnings are errors)
cargo clippy --workspace --all-targets --all-features -- -D warnings

# Run all tests
cargo test --workspace
```

## Known Gaps (M0)

- No save/write support
- No sync or conflict resolution
- No clipboard protection, locked-memory allocation, or process hardening
- No lossless round-trip guarantee (intentionally deferred)
- The domain model excludes passwords, TOTP seeds, notes, attachments, history, and custom fields

## Backlog

- **Write/save support** — requires lossless round-trip compatibility tests against KeePass and KeePassXC
- **Sync protocol** — must maintain zero-knowledge architecture
- **Clipboard and memory hardening** — critical for production use
- **Extended KDBX feature coverage** — key files, key-provider plugins, custom data
