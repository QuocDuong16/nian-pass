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

M2 — Secure Vault Read/Edit APIs

The workspace contains a KDBX-independent, secret-free metadata projection; an
explicit zeroizing `SecretString` for narrow password and notes reads; a
`keepass-rs` adapter with preservation-aware title, username, URL, and password
mutations; and a small read-only CLI. Group names, entry metadata, identifiers,
and file paths remain privacy-sensitive even when they are not cryptographic
secrets. Protected Title, UserName, and URL fields are represented without
plaintext in bulk projections.

Read support is verified only for the combinations backed by trusted fixtures.
See [KDBX compatibility](docs/kdbx-compatibility.md) for the evidence matrix and
known gaps. The experimental KDBX 4.1-only library foundation retains the
complete parsed database, fetches password or notes only for an explicit entry
UUID, changes only the requested standard field, serializes to a caller-owned
writer, and verifies both Nian Pass self-roundtrips and the exact external
KeePassXC title-mutation pipeline recorded in the compatibility matrix.

There is no CLI mutation command, no in-place or production filesystem save,
and no broad CRUD API. Notes editing, TOTP, arbitrary custom-field access,
create/delete/move, UI, sync, and server features remain out of scope. KDBX 3.1
and 4.0 writing are deliberately rejected rather than upgraded or rewritten.

## CLI

```bash
cargo run -p nian-pass-cli -- info path/to/database.kdbx
cargo run -p nian-pass-cli -- list path/to/database.kdbx
```

Both commands prompt for the master password interactively. There is no
password command-line option. `list` prints group names and entry titles only
because the user explicitly requested that output; applications must not treat
that output as safe for logs or telemetry. A protected title is shown only as
the fixed `[protected]` marker. `info` reports the exact KDBX major and minor
version from the opened file plus group and entry counts.

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
