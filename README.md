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

M4.Q — Quality, Security & Architecture Gates

M4.Q adds machine-enforced repository policy without adding product features.
The root `Makefile` is the single developer/CI interface for formatting, typed
linting, tests, coverage and changed-line coverage, dependency policy, dead
code, architecture/security invariants, contract drift, builds, and docs.

M4.0 + M4.1 remain the current product functionality: Desktop Shell +
Unlock/Browse Vault.

`apps/desktop` is the first visible Nian Pass application: a Tauri 2 shell with
React, strict TypeScript, Vite, and pnpm. It selects a local `.kdbx` through a
native dialog, unlocks a Rust-owned `VaultSession` with a password supplied for
that attempt only, displays the group tree and secret-free entry summaries, and
explicitly drops the session on Lock. The absolute selected path remains in
Rust; JavaScript receives only the selected filename and presentation DTOs.

M4.1 is browse-only. It has no password reveal/copy, entry detail, editing,
save UI, search, cloud transport, autosave, or background file monitoring. The
desktop source, frontend headless tests/build, and native headless compile are
available, but Nian Pass is still experimental and not a user-ready product.

M3.5 remains complete as the underlying conflict-safe sync engine.

The workspace now includes `vault-sync`, a synchronous provider-independent
three-way semantic merge core. Callers supply an explicit last common BASE plus
already-opened LOCAL and REMOTE `KdbxDocument` values. UUID identity,
deleted-object tombstones, field protection, hierarchy location, history,
attachments, custom icons, and database metadata participate in analysis.
Independent field/location changes can merge; same-field divergence,
delete-versus-modify, different moves, UUID collisions, subtree deletion
conflicts, invalid hierarchy, and unsupported synthesis return structured
value-free conflicts. There is no intentional timestamp/file-level
last-writer-wins fallback and conflicted analysis returns no partial document.
Root identity/location remain fixed while root metadata and ordering participate
in merge. Surviving BASE-relative child order is checked separately from
membership, so reorder plus add/remove/move cannot silently become LOCAL-wins.
Attachment-free history can be unioned deterministically; attachment-bearing
history that would cross database generations fails closed. A synthesized
candidate must pass the complete sync invariant validator before return.

M3.5 has no provider, network transport, base cache, background task, UI, or
automatic save behavior. A future application remains responsible for opening
the encrypted generations, selecting the correct BASE, and installing a
successful merged document through the safe persistence boundary.

M3 remains complete: the workspace contains a local `VaultSession` that owns
one canonical
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
recycle-bin behavior, notes editing, TOTP, attachment/icon UI, expiry editing,
history restore, duplicate, bulk operations, search, UI, cloud providers,
network sync, and server features remain out of scope.
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
make tools-install     # one-time pinned Rust quality tooling
make quality-check    # canonical full pre-merge gate
make quick-check      # faster feedback; not equivalent to quality-check
```

`quality-check` uses frozen Cargo/pnpm lockfiles, remains headless, and runs the
external KeePassXC suite when `keepassxc-cli` is available. Forgejo requires
that compatibility suite in its dedicated job. Node comes from `.node-version`
and pnpm from the exact root `packageManager` field.

Individual reusable targets remain available for focused work:

```bash
make fixture-check
make scripts-check
make architecture-check
make rust-check
make desktop-check
make security-check
make docs-check
```

### Headless Linux desktop development

Native compilation does not require an X11/Wayland session. On Debian
Bookworm/Ubuntu, install the Tauri 2 build prerequisites without installing a
desktop environment:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Then run the no-GUI native gates:

```bash
cargo check --locked -p nian-pass-desktop
cargo test --locked -p nian-pass-desktop
pnpm --filter @nian-pass/desktop tauri build --no-bundle
```

`tauri build --no-bundle` compiles the native application without producing an
installer and does not launch a window. `pnpm --filter @nian-pass/desktop dev`
serves only the frontend and is useful for browser-oriented UI work, but real
desktop commands require Tauri.

On a graphical Linux, Windows, or macOS development machine, a manual runtime
smoke test can use:

```bash
pnpm --filter @nian-pass/desktop tauri dev
```

The expected flow is select a synthetic fixture, enter its public fixture
password, browse groups/entries, and Lock back to the unlock screen. `tauri
dev` is intentionally not a headless or Forgejo quality gate.

The dedicated Forgejo compatibility job installs the pinned Debian Bookworm
KeePassXC package and runs `scripts/test-keepassxc-compat.sh --require`, where a
missing external binary is a failure rather than a skip.

See [the architecture](docs/architecture.md) and
[threat model](docs/threat-model.md) for the current boundaries and known gaps.
See [quality policy](docs/quality.md) for pinned tools, coverage ratchets,
dependency/advisory handling, and the reviewed exception process.

Nian Pass remains experimental and is not production-ready. The desktop UI is
browse-only; there is no cloud transport/provider integration, manual conflict-resolution UI, file
watcher, autosave timer, keyfile support, master-
password rotation, biometric unlock, or guaranteed zeroization of all decrypted
allocations owned by `keepass-rs`. The CLI remains read-only. Local persistence
uses optimistic conflict detection rather than cooperative or distributed
locking. Windows open/read sessions are supported, but dirty save currently
fails closed with `UnsupportedPersistencePlatform` pending a safe-Rust,
security-preserving replacement implementation whose failure states also keep
the canonical path present, plus native primary/backup DACL evidence. See [write
safety](docs/write-safety.md) for exact guarantees and limitations.
