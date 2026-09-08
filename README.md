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

M8 — Security Hardening / Release Engineering — IN PROGRESS

Current release candidate source: `0.1.0-rc.3`. After this exact generation is
reviewed and Forgejo CI is green, an operator may create the matching
`v0.1.0-rc.3` tag for a GitHub draft prerelease. Source preparation does not
create release tags.

M8 now provides pinned release inputs, a single `VERSION`, clean-tree and tag
consistency gates, hardened release profiles/CSP/filesystem opens, deterministic
browser and Native Messaging packages, Linux/Android/gateway production build
paths, SHA-256 checksums, SBOM/provenance output, artifact regression scanning,
and a tag/manual-only GitHub multi-platform release workflow. Forgejo remains
the canonical routine CI authority; GitHub is only the mirror release execution
and distribution surface. Release classification comes from `VERSION`: RC and
beta suffixes are prereleases, while an unsuffixed version is final. Tag pushes
stage drafts only; publication requires a
manual request with observed Forgejo PASS. Draft assets may be replaced, but a
published release is immutable and corrections require a new version/tag.
`SHA256SUMS` covers the final status report, SBOM, release manifest, and platform
payloads while excluding only itself. M8 is not marked DONE until the
new commit has a green canonical Forgejo gate, a real GitHub release dry-run is
reviewed, and the release report records
platform runtime and signing results without converting `NOT RUN` into `PASS`.

Desktop explicit sync supports WebDAV, AWS S3, and the Nian Pass Sync Gateway
with manual only operation; provider credentials are not persisted.

Windows and Linux desktop now provide explicit **Sync now** for one exact
remote KDBX object through WebDAV, AWS S3 / compatible endpoints, or a
self-hosted Linux Nian Pass Sync Gateway. Providers return only
encrypted bytes and an opaque revision; `sync-engine` combines the encrypted LOCAL generation, the
last proven encrypted BASE, and the encrypted REMOTE generation, then delegates
all semantic decisions to the existing network-free `vault-sync` crate.

Remote creation is `If-None-Match: *`; replacement is bound to the exact strong
WebDAV ETag, opaque S3 revision, or gateway ciphertext-derived strong ETag with
`If-Match`. A race becomes
`remoteChanged`, never a blind overwrite. Merged or explicitly authoritative
generations use a private encrypted journal, remote-first CAS, verified safe
local replacement, and an atomic BASE update last. BASE and candidate files are
ordinary encrypted, KeePassXC-readable KDBX ciphertext—no wrapper encryption or
plaintext vault representation is persisted.

Sync persistence schema v2 binds BASE and recovery state to one exact remote
target. Target-unbound state from earlier development builds is never migrated
automatically. The Sync section classifies it explicitly and offers a confirmed,
offline reset that removes only Nian Pass sync metadata; local and remote KDBX
files remain untouched, and the next Sync now follows the normal initial-sync
rules.

Sync is manual only and requires a clean saved vault, the real master password,
and freshly entered provider credentials. WebDAV passwords, S3 secret keys and
session tokens, gateway access tokens, and the master password are never persisted. Production
endpoints require HTTPS; plaintext HTTP is accepted only on loopback for local
tests. The gateway stores exact opaque encrypted KDBX bytes under validated
UUID-v4 identifiers, uses conditional create/exact CAS replacement, and never
parses vault contents. See [Self-hosting the Sync Gateway](docs/self-hosting.md).
Direct Google Drive/Dropbox/OneDrive OAuth, Android cloud sync, Apple sync,
background sync, accounts, sharing, and server-side merge are not implemented.

## Completed M6.5 milestone

M6.5 — Browser Native Messaging / Desktop Integration

Browser integration now provides Chromium/Firefox MV3 artifacts with explicit
per-site access, the Nian Pass Native Messaging host, explicit approval in the
running desktop process, unlocked-desktop credential lookup, explicit
credential selection, and exact-document field filling. It never automatically
submits a form.

The popup starts each desktop connection explicitly. Every new native-host IPC
stream produces a generic Allow/Deny request in the desktop and gains authority
only for that stream lifetime. Candidate lists are secret-free. The browser
receives neither the KDBX master password nor a vault-opening surface; a locked
vault is unlocked only in Nian Pass desktop. The transport-only native host
never opens KDBX, owns a `VaultSession`, caches credentials, or exposes a
localhost service.

The background binds random single-use candidate handles to the exact active
tab, top frame, canonical origin, document nonce, opaque field handles,
`vaultSessionId`, and Native Messaging generation. It revalidates browser
authority before and after the Rust request. The running `DesktopVaultService`
then revalidates the current session, `EntryId`, and exact browser origin through
`credential-provider-core` before returning one bounded credential response.

Release engineering separates routine validation from production builds.
Forgejo Actions remains the normal development CI on self-hosted Docker/DIND
infrastructure. GitHub Actions is release-only: an explicit existing `v*` tag
drives native Windows MSVC/NSIS, Linux, Android, browser, gateway, and final
attestation jobs. It has no branch, pull-request, scheduled, or Apple job and
does not replace Forgejo source/quality authority. Releases remain drafts until
an operator reviews the exact checksummed artifact set and
records Forgejo PASS for publication. Published assets and notes are immutable;
subsequent corrections require a new version/tag. Apple
runners remain deferred.

## Completed M5.5 milestone

M5.5 — Android Mobile Security / Lifecycle

M5.5 protects every sensitive Android Activity with native `FLAG_SECURE`, adds
API 33+ Recents screenshot suppression, and places an opaque native privacy
curtain over the WebView before foreground is lost. Each sensitive Activity has
its own resumed/focused authority and monotonic generation; pause or focus loss
immediately invalidates only that Activity, while process/screen transitions
invalidate every attached Activity. `MainActivity` and `CredentialActivity`
cannot acknowledge one another's curtain. Delayed process lifecycle callbacks
are not the confidentiality boundary. An explicit resume acknowledgement
requires the exact caller Activity's current generation plus foreground,
interactive, device-unlocked state and keeps the curtain in place until React
has reconciled the real Rust vault state. The curtain is a visual/accessibility
boundary; it is not backend Lock.

Clean background, screen-lock, and foreground-idle expiry invoke the existing
two-phase Rust Lock transaction. Dirty Rust mutations and frontend edit drafts
instead stay hidden behind an explicit Save-and-lock, discard-and-lock, or
continue decision; lifecycle handling never autosaves or silently discards.
Foreground inactivity defaults to five minutes with 1, 5, 15, 30 minute and
Never choices. The choice is process-memory only, survives Lock, unlock, and
source selection in the same running app process, and resets to five minutes
when a new app process starts. Never disables foreground inactivity expiry
only; native background protection remains mandatory.

M5.4 — iOS Password AutoFill + Keychain remains DEFERRED.

Apple platform support is intentionally postponed because completing the native
integration requires macOS/Xcode and Apple-specific development infrastructure
outside the current product priorities. This is a roadmap decision, not a
technical failure or a claim that iOS support is complete.

The reusable M5.4 foundations are preserved: `credential-provider-core`
owns the exact Android application/web and iOS service matching policy, Android
M5.3 now consumes that same crate, and `ios-credential-ffi` provides a narrow
panic-contained C ABI over the existing Rust `KdbxDocument`. The shared iOS UI
contract is read-only and exposes select, unlock, secret-free browse/detail,
Lock, and semantic Password AutoFill controls without registering Save or CRUD.

Native Apple completion is deferred. There is no official Tauri Apple project,
Swift `UIDocumentPickerViewController` adapter, coordinated security-scoped
read implementation, App Group/Keychain integration, Xcode Credential Provider
target, signed entitlement evidence, embedded extension, or system AutoFill
smoke. The retained Rust, source-policy, command, and frontend foundations do
not constitute current iOS or macOS support.

Current product direction is a KDBX-native, offline-first, zero-knowledge
password manager with no proprietary vault lock-in: Windows and Linux desktop,
Android mobile, browser integration, desktop bring-your-own-cloud sync, and a
self-hostable sync gateway. Apple-specific runtime validation and native
integration are future work; Tauri's theoretical macOS target support is not a
claim that the macOS application has been validated or released.

## Roadmap

```text
M5.0 Mobile Foundation                           DONE
M5.1 Mobile Unlock + Browse                     DONE
M5.2 Android CRUD + Safe Persistence            DONE
M5.3 Android Credential Provider + Autofill     DONE

M5.4 iOS Password AutoFill + Keychain           DEFERRED

M5.5 Android Mobile Security / Lifecycle        DONE
M6   Browser Extension Foundation               DONE
M6.5 Browser Native Messaging / Desktop Integration DONE
M7   BYO-cloud Sync Providers                   DONE
M7.5 Self-hosted Sync Gateway                   DONE
M8   Security Hardening / Release Engineering  IN PROGRESS
M9+  Apple Platform Resume                     DEFERRED
```

M8 completion is the current milestone. M6.5 uses standard browser
Native Messaging transport but does not implement or claim compatibility with
the KeePassXC-Browser wire protocol. It requires neither `keepassxc-proxy` nor a
KeePassXC executable. Chromium development uses the committed public Manifest
key and deterministic extension ID `hikglhjadglkpicocjdjipeifnemoplg`; that ID
is not guaranteed to be the eventual Chrome Web Store ID, and no private
signing key is committed. Firefox retains the development ID
`browser@nian-pass.local`. Browser approval is session-scoped, with no
persistent trusted-browser pairing.

The Desktop MVP remains complete through M4.5 and the M5.2 Android CRUD/Save
protocol remains unchanged. Android now adds password retrieval through a
`CredentialProviderService` on API 34+ and an `AutofillService` fallback on API
26–33. Both use the same Rust-owned matching and fulfillment core. Android 8.0
/ API 26 remains the minimum. Read-only providers remain browsable with editing
and Save disabled.

Save is fail-closed: the real content URI stays native-only behind an opaque
token; Rust fingerprints the complete encrypted generation, verifies the Save
credential and encrypted candidate, and Kotlin creates an exact private backup
plus `AtomicFile` recovery journal before destructive provider write. Provider
read-back must match the candidate and reopen with equivalent KDBX semantics
before Rust updates the baseline and clears dirty state. Ambiguous post-write
states return `save_uncertain`; unknown crash generations return
`recovery_required`. There is no force overwrite or autosave.

Autofill source remembering is explicit opt-in. Android retains the selected
SAF READ grant and writes only a versioned source bookmark plus package trust
associations, encrypted with a non-exportable AES-256-GCM Android Keystore key
in app-private no-backup storage. Lock always drops the decrypted Rust session;
the remembered bookmark only lets a cold credential request stage the selected
KDBX before the user enters its real master password again. Disable Autofill
deletes the bookmark and trust metadata and releases the retained grant when no
active vault still owns it.

An active normal M5.2 vault may continue to own READ + WRITE for explicit Save.
After a remembered vault successfully completes the existing two-phase Lock,
native Android releases WRITE and verifies that only READ remains before Rust
drops the decrypted session. Cold Autofill rehydration is always read-only.

Android still does not support biometric quick unlock, master-password or KDBX
derived-key persistence, passkeys, TOTP autofill, external credential
save/create, or sync. Biometric quick unlock remains deferred because the
reviewed KDBX credential boundary does not expose reusable non-password unlock
material suitable for Android Keystore auth-per-use wrapping; the separate
M5.3 metadata key is never reused for that purpose. Deferred Apple work provides no
current iOS CRUD/Save, Password AutoFill, biometric quick unlock, stored unlock
material, passkeys, OTP, credential save/create, or sync support.

`apps/desktop` remains the historical path for the shared Tauri application
host. Renaming it is deferred to a dedicated mechanical refactor. Desktop and
Android compile the same Rust application package and share `vault-core` and the
authoritative `kdbx` adapter. Desktop alone uses `VaultSession` persistence.
Android never enters `VaultSession`; its separate provider adapter contains no
Kotlin KDBX parser or cryptography and delegates all KDBX serialization and
semantic verification to the existing Rust writer.

The current Linux environment can build Android through command-line tooling
without Android Studio, an emulator, or a connected device. Apple initialization
and builds are intentionally outside normal development while Apple work is
deferred. If that work resumes, it requires macOS with Xcode and the official
Tauri iOS initialization path; Linux quality never fabricates or requires it.

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

M3.5 remains complete as the provider-independent semantic merge authority used
by M7.

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

`vault-sync` still has no provider, network transport, base cache, background
task, UI, or automatic save behavior. M7's separate `sync-engine` opens the
encrypted generations, validates the exact BASE, invokes `vault_sync::merge`,
and installs a successful generation through the safe persistence boundary.

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
history restore, duplicate, bulk operations, search, Android network sync,
direct cloud OAuth providers, and server/gateway features remain out of scope.
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

### Android credential retrieval and safe provider persistence

The committed Tauri-generated project is at
`apps/desktop/src-tauri/gen/android`. It targets the normal Rust Android ABI
set (`aarch64`, `armv7`, `i686`, and `x86_64`); the Android build gate
prioritizes `aarch64` and `x86_64` for a modern physical device and emulator.
M5.3 retains `minSdk = 26`: API 34+ uses the Android Credential Manager provider
API for password credentials, while API 26–33 uses the classic AutofillService.
The provider dependency is pinned to `androidx.credentials:credentials:1.6.0`;
no Play Services auth provider is used. Android production builds do not
request network permission. Development
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

Android selection uses `ACTION_OPEN_DOCUMENT` and retains only actually granted
read/write persistable permissions. The URI never crosses into Rust presentation
models or React and is never converted into a filesystem path. Native Kotlin
maps it to an unpredictable token and stages only encrypted KDBX bytes below
`noBackupFilesDir`; Rust owns the authoritative `MobileVaultSession`. Providers
without a persisted writable grant remain browse-only. Picker cancellation
preserves the current selection and dirty sessions cannot be replaced silently.

In Settings, **Enable Autofill for this vault** performs the explicit source
opt-in, and **Open system settings** launches Android's provider settings rather
than toggling provider state. A locked or cold provider returns only an
authentication action/dataset. After normal KDBX unlock, Rust matches
`AndroidApp` by exact package and web URLs by exact canonical host, returns
secret-free candidates, revalidates the selected stable entry and target, then
passes the exact current username/password directly to the native system-result
builder. Passwords, package certificate identities, content URIs, AutofillIds,
and request parcelables never cross WebView IPC.

On API 34+, a direct application request remains an APP target. If
`CallingAppInfo.isOriginPopulated()` reports a privileged request, Nian Pass
passes its bundled versioned browser allowlist to `CallingAppInfo.getOrigin()`
and accepts only a verified HTTPS origin with no userinfo, path, query, or
fragment. A verified `https://example.com` becomes the WEB target
`example.com`, while allowlist/certificate failure is unavailable and never
downgrades to the browser package.

An application association is silently trusted only when both its exact package
and SHA-256 signing-certificate pin match. First association, signing-key
changes, and every unverified web association require explicit confirmation.
Opaque request and candidate tokens are short-lived and single-use. Kotlin does
not parse KDBX and keeps no password cache; Autofill neither invokes Save nor
handles external create/save requests.

Credential authentication PendingIntents use a random data-URI identity rather
than a process-local request counter. After process restart, the private
credential Activity extracts the Android-supplied begin/final Credential Manager
request with `PendingIntentHandler`, or the classic Autofill `AssistStructure`,
revalidates the target, and creates fresh in-memory authority. Framework request
objects are never written to the encrypted metadata store or any other disk
cache.

Optional device/emulator smoke procedure: open a committed synthetic fixture,
unlock, edit, Save, Lock, reopen, and verify the edit; then repeat with an
external modification and verify Save refuses to overwrite it. This does not
replace the automated Rust, Vitest, Kotlin, source-policy, and APK checks.

Optional credential smoke uses only a synthetic vault. On API 34+, enable Nian
Pass as a credential provider, enable Autofill for the synthetic vault, Lock,
open a test login form, authenticate through Nian Pass, select an entry, and
verify the system fills it. On API 26–33, enable Nian Pass as the AutofillService
and run the equivalent authenticated-dataset flow. For security smoke, install
the same package name with another signing certificate and confirm it is not
silently trusted; an unverified web target must also show explicit confirmation.

### Deferred Apple platform architecture (future M9+)

The retained M5.4 design requires this future host boundary:

```text
UIDocumentPickerViewController
  -> balanced security-scoped access + NSFileCoordinator
  -> app-private encrypted staging
  -> Rust MobileVaultSession read-only unlock/browse
  -> encrypted App Group mirror (size + SHA-256, candidate-before-swap)
```

The future Credential Provider Extension must be a separate process. It must read only the
Nian Pass-owned encrypted mirror, request the real master password in native
UIKit, and call the `ios-credential-ffi` static library. It never receives the
host security-scoped bookmark or host decrypted session. The FFI verifies the
configured mirror generation before KDBX parsing and revalidates the stable
entry plus exact service before returning one username/password result.

The deferred Swift implementation requires two Keychain boundaries: a host-only item
for the external security-scoped bookmark, and a host+extension shared item for
only `version`, enabled state, fixed mirror relative name, generation size and
SHA-256, plus optional display metadata. Both require
`kSecAttrAccessibleWhenUnlockedThisDeviceOnly` and no synchronization. Keychain
must contain NO master password, NO derived KDBX key, and NO entry password.
`ASCredentialIdentityStore` intentionally receives limited username/domain and
stable record-identifier metadata, never a password; all suggestions remain
untrusted until final Rust revalidation.

Explicit Save verifies the full encrypted baseline, password, private encrypted
candidate, exact private backup, crash journal, final pre-write baseline,
provider read-back, and final KDBX semantics. The generic SAF writer race is
narrowed but not claimed eliminated; any missing proof after destructive write
is `save_uncertain`, and an unknown interrupted generation is
`recovery_required` rather than guessed or overwritten.

`make mobile-ios-tools-check` and `make mobile-ios-check` are macOS-only gates.
The latter requires the official generated Xcode graph, builds the actual host,
requires one embedded Credential Provider extension, and inspects host/extension
AutoFill, App Group, shared Keychain, and password-only capabilities. These
Apple resumption gates remain fail-closed, fail clearly on Linux, and are not
part of Linux `quick-check`, `quality-check`, or ordinary CI.

Resume Apple platform work only when a macOS/Xcode environment and the required
Apple development infrastructure are available:

1. Run `make mobile-ios-tools-check`.
2. Run the official pinned-Tauri `tauri ios init` flow.
3. Implement the real Swift Tauri plugin and Credential Provider Extension.
4. Configure the App Group and host-only/shared Keychain separation.
5. Build the confined encrypted KDBX mirror and link the retained Rust FFI.
6. Validate the real Xcode build, embedded `.appex`, and signed entitlements.
7. Complete an actual system Password AutoFill smoke with a synthetic vault.

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

On a graphical Linux or Windows development machine, a manual runtime smoke test
can use:

```bash
pnpm --filter @nian-pass/desktop tauri dev
```

The expected flow is select a synthetic fixture, enter its public fixture
password, browse groups/entries, inspect safe detail, explicitly reveal/copy a
synthetic value, and Lock back to the unlock screen. `tauri dev` is intentionally
not a headless or Forgejo quality gate. macOS desktop runtime validation is part
of the deferred Apple platform work and is not implied by this procedure.

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
