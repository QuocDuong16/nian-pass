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

M1.5 — External KeePassXC Write Compatibility

The workspace contains a KDBX-independent domain projection, a `keepass-rs`
adapter, and a small read-only CLI for credential-free vault metadata.
Group names, entry titles, identifiers, and file paths remain privacy-sensitive
even though they are not secret cryptographic material.

Read support is verified only for the combinations backed by trusted fixtures.
See [KDBX compatibility](docs/kdbx-compatibility.md) for the evidence matrix and
known gaps. The experimental KDBX 4.1-only library foundation retains the
complete parsed database, renames one entry title by UUID, serializes to a
caller-owned writer, and verifies both a Nian Pass self-roundtrip and the exact
external KeePassXC combination recorded in the compatibility matrix.

There is no CLI mutation command, no in-place or production filesystem save,
and no broad CRUD API. KDBX 3.1 and 4.0 writing are deliberately rejected
rather than upgraded or rewritten.

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
# Skips clearly when keepassxc-cli is unavailable locally.
scripts/test-keepassxc-compat.sh
```

The dedicated Forgejo compatibility job installs the pinned Debian Bookworm
KeePassXC package and runs `scripts/test-keepassxc-compat.sh --require`, where a
missing external binary is a failure rather than a skip.

See [the architecture](docs/architecture.md) and
[threat model](docs/threat-model.md) for the current boundaries and known gaps.

Nian Pass remains experimental and is not production-ready. There is no
in-place save, atomic filesystem replacement, sync, or write support outside
the exact KDBX 4.1 combinations in the compatibility matrix. See
[write safety](docs/write-safety.md) for the future production save policy.
