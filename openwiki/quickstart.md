---
type: Quickstart
title: Nian Pass — Quickstart
description: Entry point for understanding Nian Pass, an experimental KDBX-native password manager with Tauri desktop app, Android mobile, browser extension, sync gateway, Rust backend, and machine-enforced quality policy.
tags: [quickstart, navigation, overview]
---

# Nian Pass — Quickstart

Nian Pass is an **experimental, KDBX-native password manager** focused on KeePass and KeePassXC interoperability. It is written in Rust (core libraries) with a Tauri 2 desktop application (Windows/Linux), Android mobile support, a Chromium/Firefox browser extension with Native Messaging, and a self-hosted sync gateway — all organized as a Cargo + pnpm workspace.

> **Status:** Early development (M8 — Security Hardening / Release Engineering). Do not use with production credentials.

## Principles

- **KDBX-native** — the `.kdbx` file is the source of truth
- **Offline-first** — no network dependency for vault operations
- **Zero-knowledge** — sync servers must never see decryption keys
- **KeePass/KeePassXC interoperability** — must never break KeePass compatibility
- **Bring your own cloud** — users choose their own sync backend

## Current Milestone: M8 — Security Hardening / Release Engineering

M8 provides pinned release inputs, a single `VERSION`, clean-tree and tag consistency gates, hardened release profiles/CSP/filesystem opens, deterministic browser and Native Messaging packages, Linux/Android/gateway production build paths, SHA-256 checksums, SBOM/provenance output, artifact regression scanning, and a tag/manual-only Forgejo release workflow. M8 is not marked DONE until the new commit has a green canonical Forgejo gate and the release report records platform runtime and signing results.

The workspace provides:

- A KDBX-independent domain model with secret handling ([`vault-core`](/openwiki/architecture/overview.md))
- A KDBX adapter with read, mutation, save, and three-way merge ([`kdbx`](/openwiki/architecture/overview.md))
- A local unlocked vault session with verified persistence ([`vault-session`](/openwiki/architecture/overview.md))
- A provider-independent three-way semantic merge orchestrator ([`vault-sync`](/openwiki/architecture/overview.md))
- A provider-independent encrypted vault sync orchestrator with crash recovery ([`sync-engine`](/openwiki/architecture/sync-engine.md))
- Provider-neutral remote object contract ([`sync-provider-core`](/openwiki/architecture/sync-engine.md))
- Conflict-safe transports: S3 ([`sync-provider-s3`](/openwiki/architecture/sync-engine.md)), WebDAV ([`sync-provider-webdav`](/openwiki/architecture/sync-engine.md)), Sync Gateway ([`sync-provider-gateway`](/openwiki/architecture/sync-engine.md))
- Strict browser-native IPC transport ([`browser-native-protocol`](/openwiki/architecture/overview.md))
- Platform-neutral credential matching ([`credential-provider-core`](/openwiki/architecture/overview.md))
- A self-hosted zero-knowledge sync gateway ([`apps/sync-gateway`](/openwiki/architecture/sync-engine.md))
- A stateless browser native messaging host ([`apps/browser-native-host`](/openwiki/architecture/overview.md))
- A Chromium/Firefox MV3 browser extension ([`apps/browser-extension`](/openwiki/architecture/overview.md))
- A CLI for metadata inspection ([`apps/cli`](/openwiki/architecture/overview.md))
- A Tauri 2 desktop shell with React/Vite frontend ([`apps/desktop`](/openwiki/architecture/overview.md))
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
│   ├── cli/                       nian-pass CLI binary
│   ├── desktop/                   Tauri 2 desktop shell + React frontend
│   │   ├── src-tauri/             Rust backend (commands, state, sync, mobile, browser bridge)
│   │   └── src/                   React/TypeScript frontend (Vite, Vitest)
│   ├── browser-extension/         Chromium/Firefox MV3 extension (TypeScript)
│   ├── browser-native-host/       Native Messaging proxy (Rust)
│   └── sync-gateway/              Self-hosted zero-knowledge sync server (Rust)
├── crates/
│   ├── vault-core/                KDBX-independent domain model + secret types
│   ├── kdbx/                      KDBX adapter (keepass-rs boundary, mutations, sync primitives)
│   ├── vault-session/             Local session with verified atomic persistence
│   ├── vault-sync/                Provider-independent three-way merge orchestrator
│   ├── sync-engine/               Encrypted vault sync orchestration + crash recovery
│   ├── sync-provider-core/        Provider-neutral remote object contract (CAS)
│   ├── sync-provider-s3/          Conflict-safe AWS S3 transport
│   ├── sync-provider-webdav/      Conflict-safe WebDAV transport
│   ├── sync-provider-gateway/     Conflict-safe Sync Gateway client transport
│   ├── sync-gateway-protocol/     Wire-format invariants for gateway/client
│   ├── browser-native-protocol/   Strict bounded protocol & local IPC transport
│   ├── credential-provider-core/  Platform-neutral credential matching & secret retrieval
│   ├── ios-credential-ffi/        Narrow C ABI for iOS Password AutoFill (deferred)
│   └── windows-safe-replace/      ACL-preserving Windows ReplaceFileW
├── fixtures/kdbx/                 Synthetic test databases (4 fixtures)
├── scripts/                       Quality guard scripts (architecture, security, coverage, docs, sync, gateway, browser, release)
├── docs/                          Architecture, threat model, quality, self-hosting, release, IPC surface
├── deploy/                        Docker compose for sync-gateway
├── browser/                       Native contract fixture
├── Makefile                       Single developer/CI interface for all quality gates
└── .forgejo/workflows/            CI quality checks (Rust, desktop, browser, sync, gateway, mobile, compat)
```

See [architecture/overview](/openwiki/architecture/overview.md) for how the crates depend on each other and why. See [architecture/sync-engine](/openwiki/architecture/sync-engine.md) for the sync architecture.

## Navigation

| Topic | Page |
|---|---|
| Architecture, domain model, crate dependency, invariants | [architecture/overview](/openwiki/architecture/overview.md) |
| Sync engine, conflict authority, provider abstraction, crash recovery | [architecture/sync-engine](/openwiki/architecture/sync-engine.md) |
| Verified persistence, save protocol, platform limits | [architecture/persistence](/openwiki/architecture/persistence.md) |
| Test suite, fixtures, CI pipeline, quality scripts | [testing](/openwiki/testing.md) |

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

# Browser extension checks (format, lint, typecheck, test, build, artifact check)
make browser-extension-check

# Browser native host check (cargo check/test/clippy)
make browser-native-host-check

# Sync source checks (architecture, security, docs, sync-specific guards)
make sync-source-check

# Gateway checks (source, server, provider, integration, container)
make gateway-check

# Mobile checks (Android foundation, tools, iOS foundation)
make mobile-foundation-check

# Release checks (policy, source, artifact, stage)
make release-check

# Individual Rust targets
cargo fmt --check
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
cargo test --locked --workspace

# KeePassXC external compatibility (skips if keepassxc-cli absent)
scripts/test-keepassxc-compat.sh
```

See `docs/quality.md` for the full quality policy, coverage ratchets, and dependency policy. See `docs/release.md` for the release process.

## Known Gaps (M8)

- iOS/macOS support deferred — no Apple platform builds or native integration
- No keyfile or hardware key support
- No product-level recycle-bin, notes editing, TOTP, attachment/icon UI, or history restore
- KDBX 3.1 and 4.0 writing deliberately rejected (not upgraded or rewritten)
- No background sync, push notifications, or WebSocket transport
- No accounts, sharing, or server-side merge
- Browser extension ID is development-only; no Chrome Web Store publishing yet
- Sync gateway is single-node only; no clustering or replication

## Backlog

- **Apple platform resume** — macOS/iOS native integration, requires Xcode infrastructure
- **Extended KDBX feature coverage** — key files, key-provider plugins, custom data
- **Background sync** — push-based or scheduled sync with provider webhooks
- **Desktop search** — full-text vault search across entries and custom fields
- **TOTP/passkey editing** — in-vault OTP and passkey management
