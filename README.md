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

M0.5 — KDBX Read Compatibility

The workspace currently contains a KDBX-independent domain model, a read-only
`keepass-rs` adapter, and a small CLI for credential-free vault metadata.
Group names, entry titles, identifiers, and file paths remain privacy-sensitive
even though they are not secret cryptographic material. Saving, writing,
modification, merge, and sync are intentionally not implemented.

Read support is verified only for the combinations backed by trusted fixtures.
See [KDBX compatibility](docs/kdbx-compatibility.md) for the evidence matrix and
known gaps. This is not a claim of full KDBX or KeePassXC compatibility.

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
cargo fmt --check
cargo clippy --locked --workspace --all-targets --all-features -- -D warnings
cargo test --locked --workspace
```

See [the architecture](docs/architecture.md) and
[threat model](docs/threat-model.md) for the current boundaries and known gaps.

Nian Pass remains experimental and is not production-ready. There is no
write/save path and no round-trip preservation guarantee.
