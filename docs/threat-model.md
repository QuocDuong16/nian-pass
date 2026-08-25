# Threat Model

This is the threat model for the M3 local vault session/filesystem foundation,
the M3.5 provider-independent merge core, the M4.2 reveal/copy desktop, the
M4.3 mutation UI, the M4.4 save/conflict flow, and the M4.Q quality/security
gates. It records boundaries and assumptions; it is not a
claim that Nian Pass is ready to protect production credentials.

## Secret material

Secret material includes at least:

- Master passwords
- Database decryption keys, including derived keys
- Entry passwords
- Entry notes, which may contain recovery codes, API keys, or private text
- TOTP seeds
- Protected and unprotected custom-field values, either of which may contain
  credentials, recovery material, or private account identifiers
- Key-file contents
- Recovery secrets

Secret material must never be intentionally written to logs, telemetry, crash
reports, remote diagnostics, or normal CLI output.

## Privacy-sensitive vault metadata

Privacy-sensitive vault metadata includes at least:

- Entry titles
- Group names
- URLs
- Usernames
- Custom-field names
- Entry and group identifiers
- Database paths
- Vault names

These values are not necessarily secret cryptographic material, but they can
reveal accounts, organizations, finances, health services, or other private
context. Privacy-sensitive vault metadata must not be written to application
logs, telemetry, crash reports, or remote diagnostics by default.

The explicit `list` CLI command may print group names and entry titles because
the user directly requested that output. This is command output, not
application logging or telemetry. Terminal control characters are sanitized
before display, and a protected Title is rendered only as the fixed
`[protected]` marker rather than being revealed.

Encrypted database files, attachments, and key files are also security assets.
Their ciphertext, size, location, and modification times can expose useful
information to an attacker even when their plaintext remains unavailable.

## Threats

- Local malware and a compromised unlocked process
- Stolen or unattended devices
- Clipboard snooping
- Memory dumps and swap or crash artifacts
- Cloud provider compromise
- Future sync server compromise
- Malicious browser extensions
- Accidental sensitive logging or diagnostic output
- Database corruption and partial writes
- Power loss or disk exhaustion during save
- Filesystem and cloud-storage replacement semantics
- Concurrent writes and unresolved conflicts
- Writer serialization bugs
- Silent protected/unprotected field-state changes during mutation
- Protected KDBX metadata downgraded into ordinary clonable application strings
- Silent KDBX version downgrade or upgrade
- Silent KDF, cipher, or compression changes
- Data loss caused by reconstructing a database from an incomplete projection
- Compromised supply-chain dependencies
- Interoperability failures hidden by parser/writer self-roundtrips
- External compatibility commands hanging or failing non-interactively
- Compatibility-test credential or decrypted-content leakage
- Plaintext exposure through compatibility-test temporary files
- Accidental permanent deletion when a caller expected recycle-bin behavior
- Missing or incorrect deleted-object tombstones that break future sync
- Recursive group deletion that silently leaves or loses descendants
- Invalid group moves that create hierarchy cycles
- Custom-field values copied into bulk projections or diagnostics
- Standard, TOTP, or passkey fields mutated through a generic custom-field API
- Silent file-level last-writer-wins during synchronization
- An incorrect common BASE causing invalid change classification
- Deletion resurrection when absence is mistaken for an unchanged object
- Delete-versus-modify data loss
- Concurrent password edits resolved by timestamps
- Concurrent group moves producing cycles or an invalid root
- Attachment, history, custom-icon, or metadata loss during synthesis
- Root metadata silently ignored during divergent synthesis
- Sibling reorder silently discarded when the other branch changes membership
- Cross-generation historical attachment references bound to the wrong binary
- An invalid synthesized candidate escaping partial hierarchy checks
- Secret plaintext or custom-field values exposed by conflict diagnostics
- Malformed or drifted IPC data reaching React state
- Browser persistence retaining master-password, vault, or session state
- Direct Tauri IPC calls bypassing the reviewed desktop adapter
- Remote assets, permissive CSP, or new Tauri capabilities widening the WebView
- Render failures producing a blank screen or exposing raw exception text
- A copy-versus-Lock race writing a vault secret after Lock completes
- External clipboard replacement between ownership verification and clear
- Secret-bearing edit drafts lingering in the WebView
- Partial multi-field edits or multiple history snapshots for one Apply
- Dirty in-memory edits silently discarded by Lock or window close
- Mutation-versus-Lock races and stale selected IDs after structural changes
- Protected custom fields accidentally downgraded during value updates
- Mutation responses returning passwords, notes, or custom-field values
- A stale external KDBX generation overwritten by desktop Save
- A master password retained to make repeated Save convenient
- Wrong Save credentials modifying or re-keying the source
- Frontend optimism clearing dirty state before persistence commits
- Save responses exposing credentials, paths, backup names, or fingerprints
- Reload failure destroying the dirty local in-memory session
- Save-and-Lock locking, or Save-and-Close closing, after Save failure
- A window close silently terminating an active persistence transaction
- A successful Save failing to update the source fingerprint baseline
- A force-overwrite path bypassing external-change protection
- An unlocked vault left visible or accessible after user inactivity
- Revealed plaintext remaining visible after the window loses foreground focus
- Background WebView timer throttling extending an unlocked interval
- Idle handling silently discarding Rust dirty state or frontend-only drafts
- A visual privacy shield being misrepresented as backend Lock or screenshot prevention
- Blur clearing the clipboard before the user can paste into another application
- Manual Lock and idle expiry issuing duplicate backend Lock requests
- Auto-lock bypassing Save failure or external-conflict UX

## M4.Q desktop and repository controls

Production frontend code cannot use browser storage/cookies/cache APIs,
`eval`, `Function`, `document.write`, `dangerouslySetInnerHTML`, console output,
or runtime HTTP(S) assets. Only `src/lib/desktop.ts` may import Tauri core or
invoke commands. Runtime IPC data is reconstructed through exact-key validators
before use; malformed snapshots and unknown enum values fail closed as a
generic internal error. The application-level ErrorBoundary renders fixed
recovery guidance without the exception message, stack, props, state, or
logging.

Tauri capability JSON is held to `core:default`. The current Rust plugin
allowlist is Tauri core plus dialog and the official clipboard-manager plugin
only inside `apps/desktop/src-tauri`; filesystem, shell, HTTP, process, updater,
and every other clipboard plugin remain rejected. The JavaScript clipboard
plugin and browser clipboard APIs are forbidden, and the WebView receives no
clipboard permission. CSP is parsed and rejects wildcard default, script, or
connect sources, `unsafe-eval`, and arbitrary HTTPS connections.
The existing `style-src 'unsafe-inline'` remains a narrow styling requirement;
it does not permit script execution and is tracked in the quality policy.

Rust advisory, license, source, duplicate-version, and unused-dependency policy
is machine checked. npm production dependencies are audited separately from
dev-only tooling. Coverage is a regression guard, not proof of security; exact
DTO whitelist and state-transition assertions remain required.

## M4.3 mutation controls

Desktop mutation commands accept stable IDs and semantic request types only.
One atomic entry update prevalidates before a single tracked edit, so failure
cannot leave a partially updated entry and one Apply produces one history
snapshot/revision. Fresh secret-free snapshots replace React state after Rust
success; no optimistic tree mutation occurs. Existing custom fields preserve
their protection state, new custom fields default protected in the UI, and the
adapter remains authoritative for reserved names.

Existing custom-field edits fail closed until the exact value has loaded:
load failure cannot be converted into an empty-string mutation, while a
successfully loaded empty string remains a valid value. Retry uses the same
generation-guarded loader. Existing empty and whitespace-only names remain
manageable by exact identity, while the ordinary new-field UI rejects blank
names. Creation receipts must name an entry/group contained in their returned
snapshot, preventing stale post-create selection.

Password editing never preloads the existing password. Notes, custom values,
and protected metadata require explicit narrow loads. Drafts are component-local
and clear on Apply, Cancel, failure, navigation, Lock, and unmount; browser
persistence and logging remain forbidden. Mutation receipts and bulk/detail
DTOs carry no password, notes, or custom value.
Failed Notes loads display a generic alert and leave Notes absent from an entry
update request, so unrelated metadata may still be applied safely.

Rust is authoritative for dirty state. Plain Lock refuses dirty sessions and
does not drop them; explicit discard-lock shares the Copy/Lock lifecycle gate,
drops the session before best-effort clipboard cleanup, and never saves. Window
close calls a testable Rust policy and is prevented for dirty sessions until
explicit discard. Permanent entry and recursive group deletion use explicit
warnings and remain tombstone-based, not recycle-bin operations. Service tests
verify mutation/discard leaves the immutable source fixture byte-identical.

## M4.4 save and reload controls

Desktop Save is explicit and is the only desktop disk-write command. The
WebView supplies one component-local password string, the command immediately
moves it into `SecretString`, and the service calls `VaultSession::save`; no
layer retains the password for another operation. React clears its password
state before awaiting Save/reload and again on Cancel or transition. JavaScript
strings still cannot be deterministically zeroized.

M3 revalidates the encrypted fingerprint at actual Save execution, including
when an external editor changes the file after the credential dialog opened.
Fingerprint mismatch, source deletion, or unsupported path maps to the stable
`external_change` code without paths or digest data. There is no force-save,
ignore-fingerprint, overwrite-anyway, autosave, or automatic M3.5 merge command.
Before replacement, the external bytes and local dirty session are both
retained. `FinalExternalModificationDetected` also maps to `external_change`,
but only claims that another writer changed the target after Nian Pass installed
its candidate; it does not claim that Nian Pass never modified the primary.

Successful Save returns a newly projected Rust snapshot and the frontend
accepts it only when exact-key runtime validation proves `dirty=false`. Ordinary
pre-commit Save failure leaves the session dirty and never shows Saved.
Post-commit final read/verification and durability/backup uncertainty map to
`save_uncertain`: the frontend requests a fresh Rust snapshot, shows a final
on-disk verification warning, and never continues a pending Lock or close
intent. The refreshed session may be dirty or clean depending on how far M3
reconciled the canonical baseline; the frontend does not infer dirty state from
the presence of an error and never shows Saved for uncertainty.

Destructive reload opens and projects the current canonical file into a
candidate session before swapping it into service state. Wrong credentials,
invalid KDBX bytes, or a missing source cannot drop the existing dirty session.
Successful reload remounts the presentation so stale selections, reveals, and
drafts do not survive the external generation change.

Save holds only the desktop service mutex during M3 persistence. Mutations and
Lock cannot interleave; Save never acquires the Copy/Lock lifecycle gate, so it
cannot introduce the inverse `service -> secret-operation gate` order. While
Save is pending, React disables mutation and Lock actions and synchronously
prevents close requests. Dirty Lock/close offers Save, explicit discard, or
Cancel. Ordinary Lock and native close execute only after Save returns a clean
snapshot. Any Save error or external conflict keeps the application open and
never automatically continues pending Lock or close. Pre-commit failures and
ordinary external conflicts leave the local session dirty; some post-commit
uncertainty states may already have a clean Rust session, which the frontend
reflects only after refreshing the canonical snapshot.

## M4.5 inactivity and privacy controls

The inactivity manager records only genuine pointer, keyboard, touch, wheel,
and non-expired focus-return activity. It resets one timer/ref rather than
placing timestamps in React state, and stores the selected fixed timeout only in
application memory. Clean timeout uses ordinary `lock_vault`, which drops the
Rust session and reuses conditional clipboard cleanup. Never disables only
inactivity Lock; privacy-on-blur and manual Lock remain active.

Blur replaces the sensitive UI with a neutral privacy shield and clears
reveal-only password/notes state. It deliberately does not clear the clipboard,
because switching to a target application is the expected copy/paste flow.
Focus restores content only if the absolute elapsed-time check is still below
the deadline; otherwise clean state locks or dirty/draft state remains
shielded. This mitigates throttled WebView timers but does not claim exact timer
wakeups.

Rust dirty state and frontend-only drafts are independent safety signals. A
dirty timeout never calls `discard_changes_and_lock` automatically. It offers
Save and lock, explicit Discard changes and lock, or Continue editing. Backend
`unsaved_changes` overrides a stale clean frontend view and enters the same
decision without retry. Save failure, `save_uncertain`, and external conflict
never continue to Lock. An unfinished frontend edit cannot be saved by M4.4;
the user must return to it or explicitly discard it before security handling
continues. Pending mutation/Save/reload operations defer the competing Lock
decision, and successful explicit Save establishes new user activity.

The privacy shield is not called Locked. While dirty-idle attention is active,
the decrypted Rust `VaultSession` remains unlocked until explicit Save or
discard. The shield reduces casual window/app-switcher preview exposure but is
not universal screenshot prevention, secure re-authentication, process-memory
encryption, or protection against endpoint malware. M4.5 adds no unsafe native
screenshot hooks, retained credentials, browser persistence, force-lock,
autosave, or new Tauri permission/plugin.

## Security assumptions

- Nian Pass cannot fully protect a vault when endpoint malware controls the
  process or device while the vault is unlocked.
- Encryption at rest does not protect data already decrypted inside a
  compromised unlocked process.
- A future server must remain zero-knowledge with respect to vault content and
  must never receive master passwords or vault decryption keys.
- Operating-system access controls, secure update delivery, and the security of
  cryptographic dependencies remain part of the trusted computing base.
- Backups and remote storage may observe encrypted database bytes and metadata
  such as size and modification time.

## Retained M2.5 controls

The CLI reads the master password from an interactive terminal without echo and
does not accept a password argument. Its input buffer is cleared on drop, and
the adapter returns generic credential and format errors without embedding the
password. The bulk domain projection exposes privacy-sensitive visible title,
username, URL, tags, and identifiers plus password/notes presence flags, but
excludes protected Title/UserName/URL plaintext, password and notes plaintext,
TOTP seeds, attachment contents, history, and all custom-field values. Protected
standard metadata maps to an opaque `SummaryText::Protected` state, and the
adapter checks protection before copying any visible text into the projection.

Password and notes reads require an exact `EntryId` and return one owned
`SecretString`. Its backing `String` is zeroized on drop through `zeroize`; the
type intentionally has no `Debug`, `Display`, `Clone`, serialization, deref, or
implicit string-borrowing implementation. Callers must explicitly invoke
`expose_secret()` for the shortest practical lifetime. The adapter makes one
owned copy from the decrypted dependency representation into `SecretString` and
does not place secrets in errors or logs.

Custom-field enumeration returns `CustomFieldSummary` values containing only a
privacy-sensitive name and protection state. Even an unprotected custom value
requires an explicit entry UUID plus field name and returns `SecretString`.
Generic custom-field APIs reject the five standard fields, supported legacy and
current TOTP storage names, and KeePassXC passkey attribute names. Existing
custom fields retain their protected/unprotected mode on update, while callers
must select protection for new fields. Add, update, and delete operations retain
the prior field state in entry history; same-value updates and deletion of a
missing custom field do not change history or timestamps.

Zeroization reduces accidental residual memory but cannot guarantee removal of
copies made by the operating system, swap, allocator, runtime, compiler, or
dependencies. A compromised process while the vault is unlocked can still read
decrypted dependency state and any explicitly exposed secret.

M3.5 itself does not address clipboard access, locked-memory allocation, process
hardening, cloud transport/provider behavior, base-generation storage, or
dependency attestation. M4.2 adds bounded Rust-owned active-clipboard handling,
but it does not eliminate clipboard snooping/history or the other threats in
that list.

M2.5 confines experimental mutation to an opaque `KdbxDocument` retaining the
complete `keepass-rs` representation. It never serializes from the incomplete
`Vault` projection, never stores the master password, and looks entries up by
UUID. Title, username, URL, and password edits preserve existing field
protection. For missing non-empty Title, UserName, and URL fields, database
memory-protection policy selects the new field state; absent policy metadata
falls back to unprotected. Missing non-empty password fields remain protected
regardless of database policy. Same-value and missing-plus-empty requests avoid
history, timestamp, and representation changes. Typed errors for unknown entries, unsupported write formats,
destination I/O failure, and serialization failure do not contain identifiers,
metadata, or secrets. KDBX 3.1 and 4.0 writes are rejected. The lower-level
adapter save API still accepts only a caller-owned writer; the M3 path-owning
transaction is isolated in `vault-session`.

All entry and group mutations use stable UUID identities. Entry and group moves
validate their complete source and destination before mutation; group moves
reject root, self, and descendant targets. Same-parent moves and same-name group
renames are complete no-ops. Projections remain immutable snapshots, so a fresh
projection is required to observe document changes.

Permanent deletion is named explicitly and is separate from KeePassXC's
user-facing recycle-bin policy. Entry deletion creates a timestamped tombstone.
Recursive group deletion tombstones the parent, every nested group, and every
contained entry, matching KeePassXC 2.7.12 deletion tests; it also clears
represented custom-icon back-references and metadata UUID pointers before
removal. Root deletion is rejected. Tests verify unknown and invalid operations
leave the complete database unchanged and verify all tombstones after
save/reopen.

Tests serialize to memory, reopen the result, verify preservation invariants,
exercise wrong credentials and writer failure, and confirm the source fixture
bytes remain unchanged. CI verifies every committed fixture against
`fixtures/kdbx/SHA256SUMS` before running tests.

`keepass-rs` cannot preserve fields it does not parse, so neither self-roundtrip
nor external verification is a claim of universal lossless KDBX preservation.

## M3 filesystem threats and controls

M3 explicitly considers process crash during save, power loss, disk full, temp
serialization failure, a wrong password supplied to ordinary save, external
editors changing the vault before or during save, stale-source overwrite,
unsafe Windows delete-then-rename behavior, partial/corrupt backup writes,
destination DACL loss during Windows temp replacement, a failed attempt
advancing the recovery generation, post-verification path replacement being
accepted as a new baseline, symlink/path substitution, and silently discarded
dirty sessions.

Controls are:

- The primary is never opened with truncate and is never removed before a
  complete verified same-directory replacement exists.
- Complete encrypted bytes are streamed through SHA-256 during stable open and
  before save. Save checks the primary before credential validation, again
  after temp semantic verification, and once more after backup preparation.
- Ordinary save authenticates its supplied `SecretString` against the unchanged
  current source. A typo returns `CredentialMismatch` before temp or backup
  creation and cannot become accidental master-password rotation.
- Random opaque save and backup temps use exclusive creation in the target
  directory. Buffered output is explicitly flushed and each prepared file is
  synced before commit.
- The serialized temp must reopen with the credential and match the in-memory
  document's exact version and complete parsed `Database` semantics. The final
  installed primary undergoes the same semantic check through a stable-open
  helper. Its accepted fingerprint comes from the exact handle generation that
  was hashed, parsed, hashed again, and matched to the current path.
- Exactly one previous-version backup is copied from source ciphertext through
  its own verified temp. It is committed only after the new primary is installed
  and verified, so failed pre-primary saves retain the previous successful
  recovery generation. A post-primary backup commit failure leaves the verified
  primary/session clean and returns `SavedButBackupUpdateFailed`; recovery is
  never automatic.
- All namespace replacement goes through one platform helper. There is no
  delete-destination-then-rename or unsafe direct-write fallback. Unix syncs the
  parent directory after primary and backup replacement. Windows dirty save
  fails closed with `UnsupportedPersistencePlatform` until security-preserving
  replacement is available under the workspace's safe-Rust policy.
- If primary replacement succeeds but parent-directory sync fails, the final
  target is inspected and the session baseline is reconciled before returning
  `DurabilityUncertain`; this is not reported as a pre-commit failure.
- Revision-based dirty tracking is automatic for all public document mutations.
  No-op and failed operations stay clean, successful logical mutations increment
  once, a mutation after numeric saturation sets a sticky permanently-dirty
  state, `save_to_writer` cannot clear dirty state, and drop never autosaves.
- Final-component symlinks and all non-regular sources are rejected. A backup
  symlink is also rejected immediately before replacement.

Fault-injection tests cover every named pre-replacement phase, serialization
failure, temp verification failure, final-generation replacement, primary
replacement failure, pre-existing backup preservation, post-primary backup
failure, post-replacement handling, and directory-sync uncertainty. They assert
exact source/backup byte preservation, dirty revision retention, and
transaction-temp cleanup where applicable.

## M3.5 merge threats and controls

M3.5 requires the caller to supply the last generation known common to both
sides. Selecting that BASE correctly remains a future provider/application
responsibility. The engine never infers BASE from mtime, file size, ciphertext,
or a newer-looking object timestamp.

Controls are:

- Entry and group UUIDs are identity; titles, names, paths, and ordering indexes
  are never identity.
- Changes are classified independently against BASE. Entry fields compare both
  plaintext semantics and protected/unprotected state inside the sealed KDBX
  adapter.
- Deletion requires represented `DeletedObjects` state. Concurrent
  delete-versus-modify is an explicit conflict rather than deletion or
  resurrection.
- Different changes to independent fields or to location versus content can be
  combined. Different edits to one field and different moves conflict.
- Group-subtree deletion checks descendants. Root identity/location remain
  immutable while root metadata and child order participate in merge analysis.
- Child ordering compares surviving BASE-relative UUID sequences. Ambiguous
  reorder synthesis is a group-metadata conflict even when another branch also
  adds, removes, or moves a child.
- Attachments, history, icons, metadata, and KDBX configuration participate in
  analysis. A state the pinned dependency cannot synthesize safely fails closed
  as a structured conflict. In particular, attachment-bearing historical
  entries are not cloned across database generations without proven rebinding.
- Conflict descriptors carry UUIDs and optional field categories/names, never
  competing password, note, custom-field, attachment, or icon values.
- Inputs are immutable. After tombstones are merged, a merged document is
  returned only after the complete candidate passes the full UUID namespace,
  live/tombstone, reference, root, reachability, parent/child, icon, and cycle
  validator.

The engine has no conflict-resolution UI. It does not partially apply a
conflict, upload, save, choose a side, or mutate an input. Provider/transport
races, multi-writer BASE selection, explicit manual resolution, and safe
installation through `VaultSession` remain outside M3.5.

## M4.2 desktop reveal and clipboard threats and controls

The WebView necessarily originates the password for an explicit unlock, but it
must not become a second unlocked-vault owner. Controls are:

- The password input is `type=password`, uses no browser storage or persistence
  middleware, is never logged, and is cleared immediately after every unlock
  attempt. The Tauri command moves the owned IPC string directly into
  `SecretString`; neither the desktop service nor `VaultSession` retains it.
- The selected absolute path stays in Rust. The WebView receives only a display
  filename, and public desktop errors contain stable codes without paths,
  parser failures, MAC/cipher/KDF details, or dependency debug output.
- Rust owns the only unlocked `VaultSession`. Browse and entry-detail DTOs are
  explicit serde types with exact-key tests. They carry safe summaries,
  password/notes presence, and custom-field name/protection metadata, but no
  password, notes, custom value, TOTP/passkey data, attachment, history, master
  password, `KdbxDocument`, or `VaultSession`.
- `SummaryText::Protected` maps to a marker-only DTO. Missing, visible empty,
  visible text, and protected remain distinct; protected standard-field
  plaintext is never fetched for list rendering.
- Opening an entry never fetches password or notes. Separate fixed commands
  resolve an exact entry UUID and return only one password or notes string after
  the corresponding Reveal action. Runtime validation rejects non-string or
  expanded responses. No generic arbitrary-field reveal exists.
- Reveal plaintext stays in a local detail hook rather than global state or
  browser persistence. Hide and a 15-second timer remove it from state and the
  DOM; entry/group change, Lock start, component unmount, window blur, and hidden
  visibility also clear it. The hidden state renders fixed bullets without
  fetching or retaining the real value.
- Each reveal request has a generation and entry identity. A response for entry
  A is ignored after selecting B, and starting Lock invalidates pending requests
  before the backend result. This controls stale async population of the wrong
  entry or a locking view.
- Copy Username and Copy Password are semantic Rust commands. They resolve the
  UUID through narrow secret-bearing getters and write through `ClipboardPort`;
  password copy returns only a safe receipt, so copy does not introduce password
  plaintext into React. Browser clipboard APIs and the JavaScript clipboard
  plugin are rejected by ESLint and the repository security guard.
- Copy Username, Copy Password, and Lock share one secret-operation lifecycle
  gate. The order is gate, then vault-service mutex; the service mutex is
  released before clipboard I/O, and clipboard state never acquires the gate.
  If copy wins, Lock waits for its write and lease before dropping the session
  and cleaning up. If Lock wins, it drops the session first and the later copy
  returns `Locked` without writing. Thus no already-started gated copy can write
  a vault secret after Lock completes.
- A clipboard lease contains a monotonic generation, secure-random 32-byte salt,
  and SHA-256 digest only. It contains no plaintext string. Expiration reads the
  active clipboard off the main thread and requests clear only if the generation
  is current and the salted fingerprint matches. If content already differs,
  Nian Pass relinquishes ownership and preserves that observed content. Read or
  clear failure also relinquishes the lease: inability to prove ownership or
  complete deletion does not confer indefinite future deletion authority. An
  older timer cannot clear a newer Nian Pass copy.
- Explicit Lock clears frontend secrets immediately, drops the Rust session
  before clipboard I/O, then attempts conditional clipboard cleanup. Clipboard
  read/clear failure is reported as safe `clear_failed` metadata and can never
  prevent session lock. Duplicate unlock remains rejected while a session exists.
- Every Tauri `invoke` is confined to one frontend adapter. Command errors use
  fixed reviewed error codes and never returns parser, filesystem, clipboard
  library, identifier, metadata, or secret details.
- The official clipboard-manager plugin is allowed only in desktop Rust beside
  the dialog plugin. The WebView remains `core:default` only and receives no
  direct clipboard, filesystem, shell, HTTP, process, or updater permission.
  Production CSP is unchanged: bundled local assets and IPC only, with no remote
  content or `unsafe-eval`.
- Rust service tests open the immutable synthetic KDBX fixture without a
  WebView. React tests mock the desktop adapter, so headless CI never needs to
  launch GTK/WebKit or create a display server.

Residual risks remain. Once explicitly revealed, plaintext in JavaScript/WebView
strings cannot be deterministically zeroized; a compromised WebView can observe
it during its bounded lifetime. `keepass-rs` allocations likewise lack a full
zeroization guarantee. The selected cross-platform clipboard API has separate
read and clear calls, not atomic compare-and-clear. An external application can
replace the clipboard in the narrow interval after Nian Pass re-reads and
verifies the salted fingerprint but before the OS processes clear; that content
could then be cleared. Nian Pass cannot eliminate this residual race with its
process-local mutex. Clearing the active clipboard also cannot remove copies held
by OS clipboard history, desktop clipboard managers, cloud clipboard sync, or
third-party utilities. Auto-clear is best-effort at the OS boundary, not secure
erasure. Privacy-sensitive metadata remains visible while unlocked, and native
runtime smoke testing still needs a graphical host. M4.4 has no Save As,
force overwrite, automatic conflict merge, sync transport, autosave, auto-lock,
biometrics, or screenshot protection.

## M3 residual risks

SHA-256 checks provide optimistic conflict detection, not cooperative locking.
An editor can still win the unavoidable interval between the final path check
and atomic replacement. M3 does not add a `.lock` file because KeePassXC and
cloud-folder agents would not honor it. It never auto-reloads or merges on a
conflict.

Directory `sync_all` and atomic rename behavior depend on the operating system
and filesystem. Windows open/read is supported, but write persistence is
explicitly disabled rather than risk losing the destination DACL or using a
delete gap; its fail-closed test is present but has not run on Windows in this
milestone. Network shares, removable media, and cloud-synchronized folders may
reject the Unix primitive; M3 returns an error instead of downgrading safety.

The M3.1 Windows evaluation also treats replacement failure semantics as a
threat. `ReplaceFileW` has the desired documented DACL, EFS, compression, and
named-stream preservation on success, but documented failure states can move
the old file away from its canonical name. Rename-based alternatives preserve
the prepared temp's identity instead of merging the destination security state.
Creating the first backup likewise requires its restrictive security state to
be established before publication. With no primitive satisfying all of those
properties and no native Windows/DACL runtime evidence in current Forgejo
infrastructure, the control remains fail-closed Windows save rather than a
metadata repair after publication or an unsafe fallback.

Locking or dropping the session releases the decrypted database representation,
but ordinary `keepass-rs` strings are not comprehensively zeroized. M3 does not
claim immediate physical erasure from allocator pages, swap, runtime copies, or
dependency internals. A dirty session can still be discarded by an application
that ignores `is_dirty()`; no autosave-on-drop is attempted because `Drop`
cannot report persistence failure.

M2.5 invokes a released KeePassXC CLI only from an explicit test harness. The
harness uses one synthetic public fixture credential, supplies it through
stdin rather than process arguments, disables shell tracing, captures command
output, never emits decrypted XML or protected field values, and performs all
writes in a uniquely created temporary directory removed on drop. A shell
timeout bounds the suite. The immutable source fixture is copied before use and
its bytes are checked again after the external round-trip. Local absence is an
explicit skip; the dedicated CI job uses `--require`, so absence is a failure.
