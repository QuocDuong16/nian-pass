# Architecture

Nian Pass is a KDBX-native, offline-first password manager. The `.kdbx` file is
the source of truth. M3 provides an unlocked local session and verified
filesystem persistence. M3.5 adds provider-independent, synchronous three-way
semantic merge without adding a UI, transport, cloud provider, or background
service.

## Dependency direction

```text
future UI
 ├── vault-session
 │    ├── kdbx
 │    └── vault-core
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
the same property/location rule. Tombstones turn absence into an intentional
deletion; absence without a tombstone is rejected rather than guessed.

Delete-versus-modify, different same-field edits, different moves, UUID
collisions, deleted-subtree changes, hierarchy cycles, and unsupported
auxiliary-state synthesis return structured conflicts and no partial document.
Maps are indexed by UUID, concurrent additions are installed in UUID order,
history union removes exact duplicates, and synthesized times use only source
timestamps. No wall clock, mtime, ciphertext ordering, or last-writer-wins
policy resolves ambiguity.

Semantic equality compares attachment names, values, protection state, and icon
UUID/content while normalizing `keepass-rs` attachment indexes and derived
reverse-reference caches. Those process-local implementation details are
reconstructed by the writer and are not used as sync identity; represented
orphan binary values remain part of the comparison.

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
