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

M3 — Local Vault Session & Safe Filesystem Persistence

The workspace now contains a local `VaultSession` that owns one canonical
existing regular-file target, an unlocked `KdbxDocument`, a complete encrypted
file SHA-256 baseline, and the last safely saved mutation revision. It detects
external changes optimistically, rejects a wrong ordinary-save credential,
serializes to a same-directory private temp, reopens and semantically verifies
that temp, prepares an exact previous-ciphertext backup, atomically replaces the
source, stable-opens and verifies one final target generation, marks the session
clean against that generation, and only then advances `vault.kdbx.bak`. A failed
pre-primary save does not advance the recovery generation. A clean save performs
no filesystem I/O.

The workspace also retains a KDBX-independent, secret-free metadata projection;
an explicit zeroizing `SecretString` for narrow password and notes reads; an
opaque `keepass-rs` adapter with preservation-aware field and structural
mutations; and a small read-only CLI. Entries can be created, moved, and
permanently deleted by stable UUID. Groups can be created, renamed, moved, and
permanently deleted with root/cycle validation. Custom-field listing exposes
only names and protection metadata; values require an explicit `SecretString`
read. Group names, custom-field names, entry metadata, identifiers, and file
paths remain privacy-sensitive even when they are not cryptographic secrets.
Protected Title, UserName, and URL fields are represented without plaintext in
bulk projections.

Read support is verified only for the combinations backed by trusted fixtures.
See [KDBX compatibility](docs/kdbx-compatibility.md) for the evidence matrix and
known gaps. The experimental KDBX 4.1-only library foundation retains the
complete parsed database, fetches password or notes only for an explicit entry
UUID, fetches custom values only for an explicit entry UUID plus field name,
mutates the retained source of truth through narrow stable-ID APIs, serializes
to a caller-owned writer, and verifies structural/custom-field self-roundtrips
plus the exact external KeePassXC creation/open and title-mutation pipelines
recorded in the compatibility matrix.

There is no CLI mutation command and no raw database escape hatch. Product-level
recycle-bin behavior, notes editing, TOTP, attachments, icons, expiry editing,
history restore, duplicate, bulk operations, search, UI, sync, and server
features remain out of scope.
KDBX 3.1 and 4.0 writing are deliberately rejected rather than upgraded or
rewritten.

The deletion APIs remain explicitly named `permanently_delete_entry` and
`permanently_delete_group`: they remove objects from the KDBX tree and create
deleted-object tombstones; they do not implement KeePassXC's user-facing
recycle-bin policy. Entry creation omits empty Title, UserName, and URL fields,
omits Password for `None`, and treats `Some("")` as an explicitly present,
protected password.

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
UI, cloud sync or merge, file watcher, autosave timer, keyfile support, master-
password rotation, biometric unlock, or guaranteed zeroization of all decrypted
allocations owned by `keepass-rs`. The CLI remains read-only. Local persistence
uses optimistic conflict detection rather than cooperative or distributed
locking. Windows open/read sessions are supported, but dirty save currently
fails closed with `UnsupportedPersistencePlatform` pending a safe-Rust,
security-preserving replacement implementation whose failure states also keep
the canonical path present, plus native primary/backup DACL evidence. See [write
safety](docs/write-safety.md) for exact guarantees and limitations.
