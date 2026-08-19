# Threat Model

This is the threat model for the M3 local vault session/filesystem foundation
and the M3.5 provider-independent merge core. It records boundaries and
assumptions; it is not a claim that Nian Pass is ready to protect production
credentials.

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
- Secret plaintext or custom-field values exposed by conflict diagnostics

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

M3.5 still does not address clipboard access, locked-memory allocation, process
hardening, cloud transport/provider behavior, base-generation storage, or
dependency attestation. The project must not claim resistance to those threats
yet.

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
- Group-subtree deletion checks descendants, and final hierarchy validation
  rejects cycles or root corruption.
- Attachments, history, icons, metadata, and KDBX configuration participate in
  analysis. A state the pinned dependency cannot synthesize safely fails closed
  as a structured conflict.
- Conflict descriptors carry UUIDs and optional field categories/names, never
  competing password, note, custom-field, attachment, or icon values.
- Inputs are immutable. A merged document is returned only after the complete
  candidate passes conflict and hierarchy analysis.

The engine has no conflict-resolution UI. It does not partially apply a
conflict, upload, save, choose a side, or mutate an input. Provider/transport
races, multi-writer BASE selection, explicit manual resolution, and safe
installation through `VaultSession` remain outside M3.5.

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
