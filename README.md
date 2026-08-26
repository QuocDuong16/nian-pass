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

M5.1 — Mobile Unlock + Browse

The Desktop MVP remains complete through M4.5. Android now provides real,
read-only vault access: system document selection, password unlock through the
existing Rust KDBX implementation, group/entry browse, secret-free entry detail,
and immediate Lock. Android 8.0 / API 26 remains the minimum. The selected
document is streamed through `ContentResolver` into private no-backup encrypted
staging; a path-free, Save-free Rust `MobileReadSession` owns the decrypted
document after successful unlock. The original provider document is untouched.

Android does not support Save, edit, create/delete/move, password or notes
reveal, clipboard secret copy, Autofill, Keystore, biometrics, or sync. iOS
document access remains unimplemented and is not claimed as tested from Linux.

`apps/desktop` remains the historical path for the shared Tauri application
host. Renaming it is deferred to a dedicated mechanical refactor. Desktop and
Android compile the same Rust application package and share `vault-core` and the
authoritative `kdbx` adapter. Desktop alone uses `VaultSession` persistence.
Android staging never enters `VaultSession`; there is no Kotlin KDBX parser,
second persistence algorithm, or mobile Save path.

The current Linux environment can build Android through command-line tooling
without Android Studio, an emulator, or a connected device. iOS initialization
and builds are not performed on Linux: they require macOS with Xcode and will
use the official Tauri iOS initialization path in that environment.

M4.5 — Desktop Security UX remains complete.

M4.5 makes the experimental Desktop MVP feature-complete by composing explicit
auto-lock, a background privacy shield, dirty-idle decisions, local-draft
safety, and the existing M4.4 Save/conflict flow without silent data loss. The
default inactivity timeout is five minutes; 1, 5, 15, and 30 minutes plus
Never are available. This preference is application-memory only and returns to
the default on restart. Clean idle sessions use ordinary Rust Lock. Dirty idle
sessions stay visually shielded until the user explicitly chooses Save and
lock, Discard changes and lock, or Continue editing. Frontend-only edits must be
returned to or explicitly discarded before any Lock continues. M4.Q remains
complete: the root
`Makefile` is still the single developer/CI interface for formatting, typed
linting, tests, coverage and changed-line coverage, dependency policy, dead code,
architecture/security invariants, contract drift, builds, and docs.

M4.0 through M4.5 are the current desktop functionality: Shell, Unlock/Browse,
explicit read/copy, in-memory mutation, conflict-protected Save, manual Lock,
and inactivity/background security UX.

`apps/desktop` is the first visible Nian Pass application: a Tauri 2 shell with
React, strict TypeScript, Vite, and pnpm. It selects a local `.kdbx` through a
native dialog, unlocks a Rust-owned `VaultSession` with a password supplied for
that attempt only, displays a group tree, secret-free entry summaries and
secret-free entry details, and explicitly drops the session on Lock. The
absolute selected path remains in Rust; JavaScript receives only the selected
filename and reviewed presentation DTOs.

Password and notes plaintext cross into React only after their respective
Reveal action, live in local detail state for at most 15 seconds, and clear on
Hide, entry/group change, Lock, unmount, blur, or hidden visibility. JavaScript
strings cannot be deterministically zeroized. Copy Password and Copy Username
instead use semantic Rust IPC commands; password plaintext is never returned to
React by the copy path.

After 30 seconds Nian Pass re-reads the active clipboard and clears it only if
it still matches the value written by Nian Pass. Ownership uses a per-copy random
salt, SHA-256 fingerprint, and generation in Rust without retaining plaintext
solely for tracking. Already-observed replacement content is preserved, and an
old timer cannot clear a newer Nian Pass copy. Because the portable clipboard
API has no atomic compare-and-clear, replacement between the final comparison
and clear remains a narrow residual race. Clipboard history, cloud clipboard
sync, and third-party clipboard managers may retain copies outside the process's
control.

M4.5 deliberately has no Save As, autosave, force overwrite, automatic
local/external merge, recycle-bin workflow, password generator, TOTP/passkey
editing, attachments, URL opening, search, cloud transport, biometrics, OS
keychain unlock, screenshot-blocking native code, or updater. Applying a form still mutates only the unlocked
in-memory document; only explicit Save writes. Dirty Lock and close prompts
offer Save, discard, or Cancel, and neither Lock nor close continues after a
failed or conflicted Save. The main-window close request is prevented while a
Save transaction is active.
Existing custom-field values must load successfully before editing; load
failure is retryable and cannot be converted into an empty overwrite. Existing
empty-name KDBX fields remain editable/deletable by exact identity, although the
normal new-field form rejects blank names. Failed Notes loads remain omitted
from entry updates. Creation receipts are accepted only when their IDs belong
to the returned canonical snapshot.
Nian Pass remains experimental and is not a user-ready product.

The privacy shield replaces visible vault content when the window loses focus
and clears reveal-only password/notes state, but it is visual mitigation—not a
universal screenshot-prevention control. It does not clear the clipboard on
blur, so Copy then switch-and-paste remains usable. If a dirty vault times out,
the Rust `VaultSession` remains unlocked behind the shield until an explicit
Save/discard decision. Never disables only inactivity Lock; the privacy shield
and manual Lock remain active. Endpoint malware remains out of scope.

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
make mobile-source-check
```

### Android mobile unlock and browse

The committed Tauri-generated project is at
`apps/desktop/src-tauri/gen/android`. It targets the normal Rust Android ABI
set (`aarch64`, `armv7`, `i686`, and `x86_64`); the Android build gate
prioritizes `aarch64` and `x86_64` for a modern physical device and emulator.
Future AutofillService work requires Android 8.0, so M5.1 retains
`minSdk = 26` without claiming Autofill is implemented.
M5.1 Android production builds do not request network permission. Development
builds use debug-only `INTERNET` access for the Tauri/Vite development host.

Set `ANDROID_HOME` or `ANDROID_SDK_ROOT` to a CLI SDK containing Android SDK 36,
Build Tools 36.0.0, and an NDK. Then install the two required Rust targets and
run the real APK gate:

```bash
rustup target add aarch64-linux-android x86_64-linux-android
make mobile-tools-check
make mobile-android-check
```

The tool check never downloads components, changes shell profiles, accepts
licenses, or starts a device. `mobile-android-check` invokes the repository-pinned
Tauri CLI, runs focused Kotlin source-policy tests, and validates an APK under
`apps/desktop/src-tauri/gen/android/app/build/outputs/apk/`; Gradle and Rust
build outputs remain ignored. Optional device development can use
`pnpm --filter @nian-pass/desktop tauri android dev` after the separate device
or emulator setup.

Android selection uses `ACTION_OPEN_DOCUMENT` and a temporary provider grant.
The URI never crosses into React and is never converted into a filesystem path.
Native Kotlin streams encrypted bytes to an opaque file under
`noBackupFilesDir/nian-pass-imports`; Rust opens it with `KdbxDocument`, deletes
staging after successful candidate projection, and owns a read-only session.
Wrong passwords retain staging for retry. Picker cancellation preserves the
current pending selection. Startup/drop cleanup is best-effort and scoped to
the dedicated directory; ordinary deletion is not claimed as physical secure
erasure.

Optional device/emulator smoke procedure: launch, Open KDBX, select a committed
synthetic fixture, try a wrong password, retry with `demopass`, browse groups
and entries, inspect secret-free detail, then Lock. This does not replace the
automated Rust, Vitest, Kotlin, source-policy, and APK checks.

M5.2 must separately design safe writes to a document-provider source,
including source identity, encrypted-generation baselines, conflict detection,
provider replacement/failure, external modification, and transactional
guarantees. M5.1 does not copy modified staging bytes back to the URI.

A future `make mobile-ios-check` will be a macOS-only gate after the official
Tauri iOS project is generated with Xcode available. It must fail clearly on an
unsupported host and is not part of Linux `quality-check`.

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
password, browse groups/entries, inspect safe detail, explicitly reveal/copy a
synthetic value, and Lock back to the unlock screen. `tauri dev` is intentionally
not a headless or Forgejo quality gate.

The dedicated Forgejo compatibility job installs the pinned Debian Bookworm
KeePassXC package and runs `scripts/test-keepassxc-compat.sh --require`, where a
missing external binary is a failure rather than a skip.

See [the architecture](docs/architecture.md) and
[threat model](docs/threat-model.md) for the current boundaries and known gaps.
See [quality policy](docs/quality.md) for pinned tools, coverage ratchets,
dependency/advisory handling, and the reviewed exception process.

Nian Pass remains experimental and is not production-ready. Desktop edits can
be saved explicitly through M3 safe persistence, but external divergence is
only detected and refused; it is not automatically merged. There is no Save As,
force overwrite, cloud transport/provider integration, file watcher, autosave
timer, keyfile support, master-password rotation, biometric unlock, or
guaranteed zeroization of decrypted
allocations owned by `keepass-rs` or JavaScript/WebView strings. The CLI remains read-only. Local persistence
uses optimistic conflict detection rather than cooperative or distributed
locking. Windows open/read sessions are supported, but dirty save currently
fails closed with `UnsupportedPersistencePlatform` pending a safe-Rust,
security-preserving replacement implementation whose failure states also keep
the canonical path present, plus native primary/backup DACL evidence. See [write
safety](docs/write-safety.md) for exact guarantees and limitations.
