# Nian Pass

Nian Pass is an experimental, KDBX-native password manager foundation focused
on KeePass and KeePassXC interoperability.

> **Warning:** Do not use Nian Pass with production credentials yet.

## Status

Early development. The project is not ready for real vaults.

## Principles

- KDBX-native
- Offline-first
- Zero-knowledge
- KeePass/KeePassXC interoperability
- Bring your own cloud

## Current milestone

M1 — KDBX Write Foundation

The workspace contains a KDBX-independent domain projection, a `keepass-rs`
adapter, and a small read-only CLI for credential-free vault metadata.
Group names, entry titles, identifiers, and file paths remain privacy-sensitive
even though they are not secret cryptographic material.

Read support is verified only for the combinations backed by trusted fixtures.
See [KDBX compatibility](docs/kdbx-compatibility.md) for the evidence matrix and
known gaps. M1 also introduces an experimental KDBX 4.1-only library foundation
that retains the complete parsed database, renames one entry title by UUID,
serializes to a caller-owned writer, and verifies a Nian Pass self-roundtrip.

There is no CLI mutation command, no in-place or production filesystem save,
and no external KeePassXC verification of Nian Pass output yet. KDBX 3.1 and
4.0 writing are deliberately rejected rather than upgraded or rewritten.

## CLI

```bash
cargo run -p nian-pass-cli -- info path/to/database.kdbx
cargo run -p nian-pass-cli -- list path/to/database.kdbx
```

Both commands prompt for the master password interactively. There is no
password command-line option. `list` prints group names and entry titles only
because the user explicitly requested that output; applications must not treat
that output as safe for logs or telemetry. `info` reports the exact KDBX major
and minor version from the opened file plus group and entry counts.

## Development

```bash
sha256sum --check fixtures/kdbx/SHA256SUMS
cargo fmt --check
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
cargo test --locked --workspace
```

See [the architecture](docs/architecture.md) and
[threat model](docs/threat-model.md) for the current boundaries and known gaps.

Nian Pass remains experimental and is not production-ready. There is no
in-place save, atomic filesystem replacement, sync, or externally verified
KeePassXC write compatibility. See [write safety](docs/write-safety.md) for the
future production save policy.
