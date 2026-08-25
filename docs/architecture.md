# Architecture

Nian Pass is a KDBX-native, offline-first password manager. The `.kdbx` file is
the source of truth. M4.0 through M4.5 provide a Tauri 2 + React desktop shell
for local open, unlock, browse, detail, explicit reveal/copy, memory-only
mutation, explicit save/conflict/reload, and lock. M3 provides the unlocked local session and
verified filesystem persistence beneath it. M3.5 adds provider-independent,
synchronous three-way semantic merge; M4.4 does not automatically call it when
an external source conflict is detected.

M4.Q adds no product behavior. It makes these boundaries executable through
the root `Makefile`, tested architecture/security scripts, dependency policy,
coverage ratchets, and Forgejo jobs that call the same targets used locally.

## M4.Q quality architecture

`make quality-check` composes small reusable gates rather than duplicating
their commands. Rust gates cover the complete workspace, including the Tauri
crate, while frontend gates use strict typed ESLint, TypeScript, Vitest,
Prettier, Knip, Vite build, and production-only pnpm audit. Forgejo owns only
runner setup and calls those Make targets.

The architecture guard parses Cargo dependency declarations, confines
`keepass` and Tauri to their intended layers, confines `#[tauri::command]` and
frontend `invoke`, enforces production line budgets, and rejects serialization
on `SecretString`, `KdbxDocument`, and `VaultSession`. The security guard parses
Tauri capability JSON and CSP, enforces the M4.Q plugin allowlist, and rejects
browser persistence, runtime remote assets, dangerous JavaScript, console
logging, or forbidden Rust diagnostics outside tests. Both guards have
behavioral fixture tests.

The Rust/TypeScript IPC types remain handwritten, but drift is no longer
unchecked. A committed JSON contract fixture is compared against actual Rust
Serde output and consumed by TypeScript runtime validators. The validators
require exact keys, known enum variants, correct primitive types, a real root
group, unique identities, valid group/entry references, and a complete acyclic
tree before any IPC value enters React state. Unknown errors become the generic
`internal` code. A generator dependency was deliberately deferred because this
narrow fixture/validator boundary provides runtime safety without deriving a
third-party export trait on secret-bearing domain types.

## Dependency direction

```text
React WebView
 └── secret-free DTOs / typed Tauri commands
      └── desktop Rust adapter
           └── vault-session
                ├── kdbx
                └── vault-core

future sync application path
 └── vault-sync
      ├── kdbx
      └── vault-core

CLI
 ├── kdbx
 └── vault-core

kdbx
 ├── keepass-rs
 └── vault-core

vault-core
 └── no KDBX dependency
```

## M4.2 desktop security boundary

The frontend is a presentation client, not the vault source of truth. The
desktop Rust adapter owns one `DesktopVaultService`, protected by
application-managed synchronization, and that service owns at most one
`VaultSession`. Selecting a file stores its absolute path only in Rust and
returns a display filename. Unlocking moves the IPC password string immediately
into `SecretString`, calls `VaultSession::open` on Tauri's blocking runtime,
builds a secret-free projection, and drops the credential before returning.

```text
master password (one explicit attempt)
  -> React password input
  -> unlock_vault IPC
  -> SecretString
  -> VaultSession::open
  -> credential dropped

Rust-owned VaultSession
  -> Vault projection
  -> secret-free browse/detail DTOs
  -> React group/entry/detail browser

explicit Reveal Password / Reveal Notes
  -> narrow stable EntryId command
  -> one SecretString
  -> one validated JavaScript string
  -> local detail state for at most 15 seconds

explicit Copy Password / Copy Username
  -> narrow stable EntryId command
  -> one SecretString
  -> Rust clipboard service
  -> OS active clipboard
  -> no plaintext response to React
```

The normal DTO boundary includes `SelectedVaultDto`, `VaultSnapshotDto`,
`GroupDto`, `EntrySummaryDto`, `EntryDetailDto`, `SummaryTextDto`, clipboard/lock
receipts, and stable error codes. `EntryDetailDto` contains stable ID,
title/username/URL summaries, password/notes presence, and custom-field names plus
protection states. Browse/detail DTOs exclude password and notes plaintext,
custom-field values, TOTP/passkey data, attachments, history, raw KDBX state,
and the master password. Reveal commands deliberately return only one validated
string; they never add that value to a reusable DTO or global state.

React keys the detail lifetime to the stable entry ID and lock state. Password
and notes are fetched only after their own Reveal action and are cleared on
Hide, the 15-second timeout, entry/group change, Lock start, unmount, window
blur, and hidden visibility. Generation checks prevent a late request for entry
A from populating entry B or repopulating a locking view. This minimizes WebView
plaintext lifetime but cannot provide deterministic JavaScript string
zeroization.

`AppState` owns a dedicated `std::sync::Mutex<()>` secret-operation lifecycle
gate. Only Copy Password, Copy Username, and Lock use it, with the fixed lock
order `secret-operation gate -> DesktopVaultService mutex`. Copy extracts one
`SecretString`, releases the service mutex, writes the clipboard and installs
the lease, then releases the operation gate. Lock acquires the same gate, drops
`VaultSession` and the selected path, releases the service mutex, conditionally
clears the clipboard, and only then releases the operation gate. The service
mutex is therefore never held across OS clipboard I/O.

```text
Copy Password / Username       Lock
  -> secret-operation gate       -> same gate
  -> extract SecretString        -> drop VaultSession
  -> release service mutex       -> release service mutex
  -> clipboard write + lease     -> conditional clipboard cleanup
  -> release gate                -> release gate
```

Lock completion is ordered after every earlier gated copy. If Lock wins the gate
first, a later copy observes `Locked` and cannot write. Clipboard state never
acquires the lifecycle gate, so there is no inverse lock order.

`DesktopClipboardService` owns an injected `ClipboardPort` and its own mutex. A
lease retains only a monotonic generation, 32-byte secure-random salt, and
SHA-256 digest. Expiration reads the current active clipboard on Tauri's blocking
runtime and requests clear only when both generation and fingerprint still
match. A detected external replacement is preserved, and an older timer cannot
clear a newer copy. If read or clear fails, Nian Pass returns `clear_failed` and
relinquishes the lease because it can no longer justify future deletion
authority. Tests use controlled fake clipboards and direct expiration calls, so
no display server, real clipboard, or sleep-based race is needed.

The selected plugin exposes separate cross-platform read and clear operations,
not atomic compare-and-clear or a portable change counter. An external process
can therefore replace the clipboard after Nian Pass verifies the fingerprint
but before the clear operation reaches the OS. This narrow compare-before-clear
TOCTOU is a residual platform/API risk; M4.2 does not add custom Win32, X11, or
Wayland clipboard code.

Lock drops `VaultSession` before best-effort conditional clipboard cleanup, so a
clipboard read/clear failure cannot keep the vault unlocked. Its secret-free
result reports `cleared`, `not_owned`, or `clear_failed`. The official
`tauri-plugin-clipboard-manager` is initialized only in the Rust desktop adapter.
The main WebView capability remains exactly `core:default`; it receives no
plugin clipboard permission and has no JavaScript clipboard package or browser
clipboard API. The CSP is unchanged and still permits only bundled local assets
and Tauri IPC. Dialog and clipboard are the only approved Rust plugins; shell,
HTTP, filesystem, process, updater, and remote-content capabilities remain absent.

## M4.3 desktop mutation boundary

React owns only short-lived form drafts, selected stable IDs, and validation
state. Canonical mutation remains entirely below the semantic IPC boundary:

```text
React component-local draft
  -> semantic mutation IPC using EntryId / GroupId
  -> DesktopVaultService mutex
  -> VaultSession
  -> complete KdbxDocument mutation API
  -> VaultSession dirty revision
  -> fresh secret-free VaultSnapshotDto
  -> exact-key validation
  -> replace React snapshot
```

`update_entry` prevalidates the stable entry ID and applies every requested
standard field through one tracked adapter mutation. One UI Apply therefore
creates one prior-state history item and one logical revision, while same-value
and missing-plus-empty changes remain no-ops. Structural and custom-field
commands reuse the M2.5 tombstone, cycle, reserved-field, and protection
semantics. React never reconstructs, optimistically splices, or owns the mutable
KDBX document.

Password replacement starts with an empty input and never fetches the old
password. Notes and existing custom-field values enter React only after an
explicit edit/load action. Edit drafts do not use the 15-second reveal timer so
typing is not silently destroyed; they clear on Apply, Cancel, operation
failure, entry/group navigation, Lock, and unmount. Protected title, username,
and URL values also require an explicit narrow load before editing. No draft is
written to browser storage, and JavaScript strings cannot be deterministically
zeroized.

An existing custom-field edit distinguishes not-loaded, load-failed,
loaded-empty, and loaded-nonempty states. The textarea and mutation path remain
unavailable until a successful load, while Retry reuses the generation-guarded
secret loader. Existing empty or whitespace-only KDBX field names remain exact
identities for read/update/delete; only creation of a new blank name is rejected
by desktop policy. Creation receipts are accepted only when their returned ID
is present in the same canonical snapshot.

`VaultSnapshotDto.dirty` is computed from `VaultSession::is_dirty`; React only
mirrors it. Plain `lock_vault` rejects a dirty session with
`unsaved_changes` and leaves it unlocked. `discard_changes_and_lock` is the
only desktop command that expresses destructive intent and shares the M4.2
secret-operation gate and lock order. Tauri close-request handling calls the
Rust `close_policy`; a dirty session is prevented from closing until the user
explicitly discards, while locked and clean sessions may close.
If the explicit discard succeeds but the follow-up native close request fails,
the locked screen remains authoritative and reports that only window closing
failed; it never claims that the destroyed session is still active.

M4.3 mutation commands never call `VaultSession::save`, `save_to_writer`, atomic
replacement, or backup code. Mutation responses are fresh projections only;
M4.4 adds a separate explicit write boundary.

## M4.4 desktop persistence boundary

React remains presentation-only and never reconstructs persistence state:

```text
React dirty snapshot
  -> Save credential dialog
  -> save_vault(password) semantic IPC
  -> immediate SecretString conversion
  -> DesktopVaultService mutex
  -> VaultSession::save
  -> existing M3 fingerprint/verified replacement transaction
  -> fresh Rust-authoritative clean VaultSnapshotDto
```

`save_vault` is the only desktop command that writes the KDBX source. It does
not acquire the Copy/Lock `secret_operation_gate`, so no code holds the service
mutex and then waits for that gate. The service mutex serializes Save with every
mutation and Lock; the password is dropped with the blocking request and is not
retained by `AppState`, `DesktopVaultService`, `VaultSession`, or React after the
request completes. Save and reload responses use the existing exact-key,
secret-free snapshot validator and additionally require `dirty=false`.

At actual Save execution, M3 compares the complete encrypted source fingerprint
to the session baseline. A pre-commit mismatch, missing target, or path
substitution maps to `external_change`; no temp is installed, no force command
exists, the external source remains untouched, and the local dirty session
remains active. `FinalExternalModificationDetected` also maps to
`external_change` when another writer changes the target after Nian Pass's
replacement; that classification does not claim the pre-Save primary remains.
M4.4 does not invoke M3.5 automatically. The user may keep working or explicitly
choose **Discard local changes and reload**.

Post-replacement `FinalReadFailed`, `FinalVerificationFailed`, backup failures,
and durability uncertainty map to `save_uncertain`. React refreshes the
Rust-authoritative snapshot because the session may be dirty or may already be
clean, shows no Saved status, and stops pending Save-and-Lock/Save-and-Close even
when the refreshed snapshot is clean.

Reload obtains the canonical path from the active Rust session, opens and
projects a candidate `VaultSession`, and swaps it into the service only after
both operations succeed. Wrong credentials, a corrupt source, or a missing file
therefore return `reload_failed` without dropping the local dirty document.
Successful reload returns a clean snapshot and remounts the vault presentation,
clearing stale entry/group selection, reveal state, and drafts.

Dirty Lock and close share one frontend Save flow. Save must return a canonical
clean snapshot before ordinary `lock_vault` runs; close then requests the native
window close only after Lock succeeds. Save failure or external conflict never
calls Lock, discard, or close. Explicit discard remains separate and never
saves. While Save is pending, mutation controls and Lock are disabled and a
window close request is prevented. There is no autosave, Save As, force
overwrite, or automatic merge path.

`vault-core` owns KDBX-independent domain types. `crates/kdbx` is the adapter
that contains all `keepass-rs` types and converts them to the domain model. The
CLI consumes only the adapter's public API and `vault-core` values. No
`keepass-rs` type crosses the adapter's public boundary.

`crates/vault-session` owns the canonical filesystem path, encrypted source
fingerprint, saved revision, backup policy, conflict checks, and save
transaction. It accepts `SecretString` credentials at open/save boundaries but
does not retain them. It exposes `KdbxDocument` only through the adapter's
narrow public API; no `keepass::Database`, entry, or group type escapes.

`crates/vault-sync` owns only BASE/LOCAL/REMOTE orchestration, fast-forward
classification, and dependency-neutral conflict descriptors. It has no
filesystem, credential, async runtime, provider, or `vault-session` dependency.
The narrow sync adapter inside `kdbx` clones and synthesizes the complete
private parsed database so neither `keepass` types nor a partial `Vault`
projection become a merge model.

```text
last common BASE ─┐
current LOCAL ────┼─→ vault-sync ─→ merged KdbxDocument or conflict set
current REMOTE ───┘
```

UUID is the only entry/group identity. The merge validates exact KDBX versions,
recognizes equivalent and one-sided generations, indexes groups, entries,
icons, and tombstones, then analyzes divergent KDBX 4.1 documents. Entry fields
(including protected state), location, attachments, history, and metadata are
merged independently when BASE proves that edits do not overlap. Groups use
the same property/location rule. The root UUID and location are immutable, but
its ordinary group metadata and child ordering participate in the same
three-way analysis instead of being skipped. Tombstones turn absence into an
intentional deletion; absence without a tombstone is rejected rather than
guessed.

Delete-versus-modify, different same-field edits, different moves, UUID
collisions, deleted-subtree changes, hierarchy cycles, and unsupported
auxiliary-state synthesis return structured conflicts and no partial document.
Maps are indexed by UUID. LOCAL child order is retained and REMOTE-only
additions are appended in UUID order. Ordering analysis compares the relative
sequence of surviving BASE children, so an unrelated add, removal, or move
cannot hide a sibling reorder; a REMOTE reorder that the LOCAL-based candidate
does not already represent is a group-metadata conflict. Attachment-free
history union retains LOCAL order, appends semantically unique REMOTE records
in REMOTE order, and removes semantic duplicates. Historical attachment state
is never raw-cloned across database generations: a required cross-generation
history import with attachments fails closed. Synthesized times use only source
timestamps. No wall clock, mtime, ciphertext ordering, or last-writer-wins
policy resolves ambiguity.

Semantic equality compares attachment names, values, protection state, and icon
UUID/content while normalizing `keepass-rs` attachment indexes and derived
reverse-reference caches. Those process-local implementation details are
reconstructed by the writer and are not used as sync identity; represented
orphan binary values remain part of the comparison. Historical entry parent is
a parser-derived reference to the current entry's group and is not serialized;
historical `PreviousParentGroup` is serialized and therefore participates in
semantic equality. Every conflict-free synthesized candidate runs the complete
sync invariant validator after tombstone merge and before it can be returned.

```text
.kdbx
  ↓
VaultSession
  ↓
KdbxDocument
  ↓
Vault projection
```

The save direction is preservation-first:

```text
KdbxDocument
  ↓
verified same-directory temp
  ↓
prepared exact previous ciphertext
  ↓
atomic primary replacement
  ↓
verified final .kdbx
  ↓
committed previous-generation backup
```

The adapter's read API returns an `OpenedVault` containing the `Vault`
projection and a dependency-neutral `KdbxVersion`. The version preserves the
exact major/minor header value, so the CLI can report `3.1`, `4.0`, or `4.1`
without exposing a `keepass-rs` enum.

The M2.5 domain model separates bulk metadata from explicit secret access:

- `EntrySummary` contains an identifier, `SummaryText` projections for Title,
  UserName, and URL, tags, and password/notes presence flags. `SummaryText`
  distinguishes `Missing`, `Visible(String)` (including an explicit empty
  string), and `Protected`. The `Protected` state records presence and
  protection without containing the field plaintext. `EntrySummary` never
  contains protected standard-field plaintext, password or notes plaintext,
  TOTP data, attachments, or custom-field values.
- `SecretString` owns one explicitly requested password or notes value in a
  zeroizing buffer. It has no `Debug`, `Display`, `Clone`, serialization, deref,
  or implicit string-borrowing implementation; plaintext access requires
  `expose_secret()`.
- `CustomFieldSummary` contains only a privacy-sensitive field name and
  `FieldProtection`; it never contains a field value and intentionally has no
  `Debug`, `Display`, or serialization implementation. Custom-field values,
  including values stored unprotected in KDBX, require an explicit
  `entry_custom_field` read and return `SecretString`.
- `NewEntry` is a KDBX-independent request type. Its optional password is a
  borrowed `SecretString`, so the primary creation API does not accept password
  plaintext as a raw owned `String`.
- `Vault` and `Group` remain secret-free list/navigation projections. Their
  metadata is privacy-sensitive and must not be logged or sent to telemetry by
  default.

The projection is not a serialization model. Reconstructing a KDBX database
from it is forbidden because doing so would discard semantics Nian Pass does
not expose or understand.

`KdbxDocument` privately owns the complete decrypted KDBX state represented by
`keepass::Database`. `keepass-rs` remains only the parser/writer implementation
behind the adapter. Callers may request a fresh `Vault` projection,
custom-field metadata, or one explicit password/notes/custom value, but
mutations and serialization operate on the retained complete database, never
on the projection:

```text
vault-core presentation
          ^
          | projection
    KdbxDocument
  complete opaque state
          |
      keepass-rs
```

M2 exposes only title, username, URL, and password mutation by stable `EntryId`.
A private adapter helper applies one common policy: compare plaintext before
tracking, preserve an existing field's protected/unprotected mode, append one
history item and update `LastModificationTime` only for a real change, and make
same-value or missing-plus-empty requests complete no-ops. Missing non-empty
Title, UserName, and URL fields follow the database's respective
`protect_title`, `protect_username`, and `protect_url` memory-protection policy.
Absent memory-protection metadata falls back to the standard unprotected
defaults for those three fields. A missing non-empty Password is always created
protected, including when `protect_password` is false. Database policy applies
only to missing-field creation; an existing field's protection state always
wins. URLs are stored verbatim without browser normalization.

M2.5 adds only stable-ID structural operations:

- `create_entry`, `move_entry`, and `permanently_delete_entry`
- `create_group`, `rename_group`, `move_group`, and
  `permanently_delete_group`
- `custom_fields`, `entry_custom_field`, `set_entry_custom_field`, and
  `delete_entry_custom_field`

All lookups use `EntryId` or `GroupId`; names, indexes, paths, and tree position
are never mutation identities. Upstream constructors generate UUID v4 values
and initialize KeePass timestamps. Creation does not invent history. Empty
Title, UserName, and URL inputs remain absent, `None` omits Password, and an
explicitly supplied password (including empty) is created protected. Existing
custom fields preserve protection on update; caller-selected protection applies
only to a missing field. Custom-field add/update/delete uses tracked entry
mutation, while same-value update and missing-field deletion are complete
no-ops.

The entry constructor otherwise retains upstream defaults: no Auto-Type,
tags, custom data, icon, colors, URL override, attachment, or previous parent;
quality checking is enabled and history exists but is empty. The group
constructor starts with no notes, tags, icon, custom data, children, or previous
parent; it is expanded and its Auto-Type/searching values inherit. Upstream
constructors initialize only the new object's timestamps and do not rewrite the
parent group's timestamps.

Entry moves preserve UUID, fields, and history, record the previous parent, and
update `LocationChanged`; same-parent moves are complete no-ops. Group moves
preserve UUID, reject root/self/descendant cycles, update `LocationChanged`, and
make same-parent moves complete no-ops. Every public projection call returns a
fresh snapshot: an older `Vault` value is never mutated after document changes.

Permanent deletion is intentionally distinct from KeePassXC's product-level
recycle-bin workflow. Entry deletion creates one UUID/timestamp tombstone.
Recursive group deletion creates a tombstone for every removed entry and group,
matching KeePassXC 2.7.12's `TestDeletedObjects` behavior, while cleaning custom
icon back-references and metadata UUID pointers represented by `keepass-rs`.
Root deletion is rejected. Reserved standard, TOTP, and KeePassXC passkey field
names cannot be accessed or modified through generic custom-field APIs. Root
rename remains supported because it is an ordinary KeePass group metadata edit.

The document never stores the master password; credentials are supplied again
when saving. Its writer-first API cannot open or overwrite a path.

M3 adds a process-local saturating `u64` revision to `KdbxDocument`. Every real
successful logical mutation advances change state exactly once; same-value,
same-parent, missing-field deletion, and failed operations do not increment.
Recursive group deletion is clone-then-commit and counts as one revision. The
revision starts at zero on open, is not serialized, and `save_to_writer()`
never resets it. A real mutation attempted after numeric saturation sets a
sticky permanently-dirty state, so saturation can never make a new edit appear
clean.

`VaultSession` captures `saved_revision` on stable open and after a verified
primary replacement. `is_dirty()` delegates to the document's overflow-aware
comparison. The session never autosaves on `Drop`; `lock(self)` only consumes
and drops the decrypted representation.

Final verification returns a parsed document and fingerprint from one stable
generation. That generation is hashed and parsed through one handle, hashed
again through that handle, and compared with the current path. Only after full
semantic equality does the session accept the paired fingerprint. The prepared
backup is committed afterward, so failed pre-primary transactions cannot
advance recovery history. Windows dirty saves currently fail closed because M3
does not yet have a safe-Rust, runtime-proven replacement path that both
preserves the destination security descriptor and keeps the canonical path
present across documented replacement failures. First-backup DACL behavior also
requires native Windows evidence before writes can be enabled.

M3 accepts in-memory mutations for opened KDBX 3.1 and 4.0 documents so dirty
state remains meaningful. On supported write platforms, persistence still calls
the pinned writer and returns `UnsupportedWriteFormat`. It never upgrades those
files. Windows rejects all dirty saves earlier with
`UnsupportedPersistencePlatform`.

The pinned writer only accepts exact KDBX 4.1. The adapter therefore returns
`UnsupportedWriteFormat` for KDBX 3.1 and 4.0 and performs no silent format,
KDF, cipher, or compression migration.

## M4.5 desktop security lifecycle

M4.5 adds no Rust command or persistence path. A dedicated React idle-security
hook owns one absolute `Date.now()` activity deadline, one timer, and listeners
for pointer-down, keyboard, touch-start, and wheel activity while a vault is
unlocked. It does not update React state for mouse movement or render/IPC
activity. The default is five minutes; the fixed 1, 5, 15, and 30 minute and
Never choices live only in application memory. Never disables inactivity Lock,
not manual Lock or the privacy shield.

```text
genuine user activity
  -> reset one frontend deadline/timer
  -> clean + no local draft: ordinary lock_vault
  -> Rust dirty: security shield -> Save and lock / Discard and lock / Continue
  -> frontend draft: security shield -> Return / explicit draft discard
```

Tauri's public `Window.onFocusChanged` API is confined to
`src/lib/window-lifecycle.ts`; React receives only a boolean focus event. Blur
immediately replaces the visible vault and dialogs with a neutral screen and
increments a reveal-cleanup generation. Password and notes reveals clear, while
mutation drafts remain mounted but hidden. Focus removes the ordinary privacy
shield only after comparing elapsed wall time with the absolute deadline, so a
throttled background timer cannot grant a fresh full timeout. Losing focus does
not count as activity; a non-expired focus return does. Blur never calls a
clipboard command, preserving Copy -> switch application -> paste.

`VaultSnapshotDto.dirty` and frontend-only draft state are intentionally
separate. Entry create/edit, custom-field editing, entry/group operations, and
their confirmation dialogs report draft and pending-operation state upward.
Timeout cannot call Lock while either state could lose un-applied work. A local
draft must be returned to or explicitly discarded; it is never auto-applied or
included in Save. If Rust is dirty after draft resolution, the ordinary M4.4
decision follows. Backend `unsaved_changes` from a clean-looking frontend is
also authoritative and enters the dirty security decision without retry or
discard.

Save-and-lock uses the existing fresh-credential M4.4 flow, then ordinary Lock
only after Rust returns a validated clean snapshot. Save failure and external
conflict remain shielded and do not Lock or discard. Explicit discard alone
uses `discard_changes_and_lock`. Successful explicit Save restarts inactivity;
pending Save/reload/mutation delays expiry handling until completion. A
synchronous frontend in-flight guard makes manual Lock and idle expiry issue at
most one backend Lock request, while the Rust Copy/Lock gate remains the
authoritative lifecycle boundary.

The privacy shield is visual mitigation, not backend Lock and not universal
screenshot prevention. During dirty-idle attention the Rust `VaultSession`
remains unlocked until the user explicitly saves or discards. JavaScript
strings cannot be deterministically zeroized, WebView timers may still be
throttled, and endpoint malware can inspect an unlocked process. M4.5 adds no
native screenshot FFI, plugin, capability, filesystem access, credential cache,
browser storage, autosave, force-lock, or dirty-discard shortcut.

## Architecture Invariants

1. **KDBX is the source of truth.**
2. **Nian Pass must preserve interoperability with KeePass and KeePassXC.**
3. **No sync server may possess vault decryption keys.**
4. **Vault decryption and conflict merge happen client-side.**
5. **UI/platform layers must not depend directly on the KDBX implementation.**
6. **KDBX-specific types must not leak outside the KDBX adapter boundary unless explicitly justified.**
7. **Secret material and privacy-sensitive vault metadata must not be written to logs, telemetry, crash reports, or remote diagnostics by default.**
8. **Saving a vault must not silently discard unsupported/unknown semantic data.**
9. **A KDBX file must never be reconstructed from an incomplete presentation projection.**
10. **Unsupported semantics must be preserved by retaining the complete parsed database representation whenever the underlying library supports it.**
11. **A mutation must not change unrelated field semantics, including protected/unprotected state, unless explicitly requested.**
12. **Secret-bearing fields must be fetched explicitly and must not be included in bulk vault projections.**
13. **Public mutation APIs must preserve an existing KDBX field's protection mode unless an API explicitly represents a protection-mode change.**
14. **Bulk projections must not materialize plaintext from fields marked protected in the underlying vault.**
15. **Every structural mutation must resolve stable UUID identity before changing the database.**
16. **Permanent deletion must create complete timestamped KDBX tombstones; recycle-bin policy must remain explicit and separate.**
17. **Invalid, unknown, same-value, and same-parent requests must not partially mutate retained database state.**
18. **Generic custom-field APIs must not bypass standard-field, TOTP, or passkey-specific semantics.**
19. **Ordinary save must authenticate against the unchanged current source and must never act as master-password rotation.**
20. **The primary path must never be truncated or removed before a complete verified replacement exists.**
21. **External source fingerprint mismatch must preserve both the external file and dirty in-memory edits.**
22. **A session baseline must identify the exact final generation that was parsed and semantically verified.**
23. **The previous-version backup advances only after a new primary generation is installed and verified.**
24. **A platform without security-preserving replacement must reject persistence rather than widen access or direct-write the primary.**
25. **Semantic sync requires one explicit common BASE plus immutable LOCAL and REMOTE inputs.**
26. **Ambiguous concurrent changes must return conflicts, never timestamp/file-level last-writer-wins.**
27. **Tombstones, not absence alone, establish intentional deletion.**
28. **A conflicted merge must not return or install a partially synthesized database.**
29. **The unlocked `VaultSession` must remain Rust-owned; normal browse/detail DTOs stay secret-free and only explicit reveal commands may return one secret string.**
30. **UI Lock must drop the Rust session, not merely hide the unlocked view.**
31. **Password copy must remain a semantic Rust command and must not return the password to JavaScript.**
32. **Clipboard cleanup must re-read and match both the current lease generation and salted fingerprint immediately before a best-effort clear.**
33. **Copy Password, Copy Username, and Lock must share one lifecycle gate so no pre-lock copy can write after Lock completes.**

If Nian Pass saves a database that KeePassXC can no longer open, or silently
loses supported semantic data, treat it as a P0 compatibility bug.

## Current compatibility boundary

M3 opens existing non-symlink regular files through `VaultSession`, while
`keepass-rs` still maps secret-free vault metadata into `vault-core`. Trusted
fixtures verify specific KDBX 3.1, 4.0, and 4.1 combinations; the exact evidence
and untested dimensions are recorded in [the compatibility
matrix](kdbx-compatibility.md). Format-level verification is not evidence of
complete feature compatibility for that format.

M1 proves a KDBX 4.1 Nian Pass self-roundtrip for the trusted KeePassXC 2.7.12
fixture. M1.5 separately uses a released `keepassxc-cli` as an independent
implementation: Nian Pass mutates and writes a temporary copy, KeePassXC opens
and lists it, KeePassXC performs a second explicit title mutation and resave,
and Nian Pass reopens and compares the result. The external harness also proves
that KeePassXC opens and lists a separately generated Nian Pass-created entry.
Self-roundtrip evidence is not external interoperability evidence, and neither
form proves preservation of data the dependency does not parse or byte-for-byte
ciphertext stability.

KeePassXC is test tooling only. It is not a library, runtime, or deployment
dependency of Nian Pass. The external harness writes only inside an isolated
temporary directory. M3 adds the canonical local save-to-source API described
in [write safety](write-safety.md). M2.5 self-roundtrip tests extend the evidence
to username, URL, password, structural operations, recursive tombstones, and
protected custom fields. External creation evidence proves KeePassXC open/list
only; the strict KeePassXC resave comparator remains the separate title-mutation
pipeline.
