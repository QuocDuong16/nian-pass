# Write Safety

M3 implements local persistence for existing regular filesystem files through
`vault-session`. The implementation is optimistic and preservation-first: it
does not claim cooperative locking, distributed locking, or universal
crash-proof behavior.

## Stable open

`VaultSession::open` rejects a final-component symlink, directory, device,
FIFO, socket, and other non-regular target. It canonicalizes the accepted path,
opens one handle, streams SHA-256 over the complete encrypted file, seeks back,
opens the `KdbxDocument`, then hashes the same handle again. It also reopens and
hashes the canonical path. All three fingerprints must agree before the session
starts.

The same stable-generation helper is used after primary replacement. The
fingerprint accepted as the next session baseline is the first handle digest:
that exact handle generation is hashed, parsed, rewound and hashed again, then
the current path is independently required to still name those bytes. The
parsed document is semantically verified before its paired fingerprint is
accepted. Nian Pass therefore never verifies generation B and adopts an
unverified generation C fingerprint as B's baseline.

The source fingerprint is `(encrypted byte length, SHA-256)`. Size, mtime,
inode, and other filesystem metadata are not used as conflict identity. The
digest is streamed with a fixed-size buffer and has no `Debug`, `Display`, or
serialization implementation.

## Dirty state

Every opened `KdbxDocument` starts at revision zero. Each successful real
logical mutation advances process-local change state exactly once; no-op and
failed operations do not. Revision is not KDBX data and is
not serialized. `VaultSession` compares that revision with `saved_revision`.
If a real mutation occurs while the counter is already `u64::MAX`, a sticky bit
makes the document permanently dirty for the rest of its in-memory lifetime.
This deliberately favors repeated save prompts over allowing a saturated
counter to make a real edit appear clean.

A clean `save()` returns `SaveOutcome::Unchanged` without opening, hashing,
rewriting, backing up, or changing the mtime of the vault. A dirty session is
marked clean only after the installed primary has reopened, matched complete
parsed semantics, and supplied a fresh fingerprint. `save_to_writer()` never
changes dirty state because arbitrary caller-owned output is not persistence.

## Implemented save transaction

For a dirty session, M3 performs this order:

1. Revalidate that the canonical target is an existing non-symlink regular
   file.
2. Stream-fingerprint the primary and require the session's source baseline.
3. Open the unchanged primary with the supplied `SecretString`. A rejected
   credential returns `CredentialMismatch`; ordinary save cannot silently
   rotate the master password.
4. Create a randomized opaque temp with `create_new` in the primary's parent
   directory. Unix creation mode is `0600`.
5. Serialize the complete retained `KdbxDocument` through the pinned
   `keepass-rs` writer into a buffered writer.
6. Explicitly flush the buffer and `sync_all` the temp file.
7. Reopen the temp with the supplied credential and compare exact KDBX version
   plus the complete parsed `keepass::Database` semantics through a narrow
   adapter API. The comparator follows represented attachment names, values,
   protection state, and icon UUID/content while normalizing dependency-internal
   attachment indexes and derived reverse-reference caches rebuilt by the
   writer.
8. Stream-fingerprint the primary a second time and require the original
   baseline.
9. Restrict/preserve applicable source permissions on the verified temp and
   sync it again.
10. Copy the current primary bytes into a second same-directory backup temp
    while streaming its fingerprint. Require that fingerprint to equal the
    source baseline, flush and sync the backup temp, apply restrictive
    permissions, and reopen/hash it. The prepared backup is not committed yet.
11. Run a third primary fingerprint check immediately before replacement. This
    narrows changes that race with backup preparation; it does not create a
    cross-application lock.
12. Atomically replace the primary with the already verified save temp through
    the single platform replacement helper. The implementation never removes
    the primary first and never falls back to direct truncate/write.
13. Sync the containing directory on Unix.
14. Stable-open one final primary generation: hash one handle, parse it, hash
    that handle again, and require the current path to still match. Compare the
    parsed document's complete semantics with the in-memory document.
15. Store the fingerprint paired with that verified parsed generation as the
    new source baseline and record the current document revision as saved.
16. Only now atomically install the already prepared previous-ciphertext temp
    as `vault.kdbx.bak`, then sync the backup namespace on Unix.

Fresh encryption salts, seeds, IVs/nonces, authentication data, and ciphertext
are expected, so successful saves use parsed semantic equality rather than
binary equality. Failed pre-replacement transactions use exact source byte
equality.

## Previous-version backup

M3 maintains exactly one sibling backup:

```text
vault.kdbx
vault.kdbx.bak
```

The backup is copied from the primary ciphertext; it is never reconstructed by
reserializing an old database. It represents the primary generation immediately
preceding the most recent successful save. On the first successful A-to-B save
it contains exact A bytes. On the next successful B-to-C save it atomically
rotates to exact B bytes. A failed B-to-C attempt leaves primary B and backup A
unchanged. An existing backup is never directly truncated, and the prepared
backup is not committed until primary C has been installed and verified. M3
never promotes or restores the backup automatically.

If primary C is installed and verified but committing backup B fails, the
session baseline and saved revision remain reconciled to primary C, so the
session is clean. `SavedButBackupUpdateFailed` explicitly reports that the old
backup A remains. A failure syncing the already committed backup namespace is
reported separately as `SavedButBackupDurabilityUncertain`.

On Unix, save and backup temps start at `0600`; installed files retain only the
source owner's read/write permission bits (`source mode & 0600`). This may make
an originally broader mode more restrictive and never broadens it. Rename-based
replacement creates a new inode owned by the saving user; M3 does not attempt
privileged `chown` or promise preservation of every metadata bit.

Windows write persistence currently fails closed with
`UnsupportedPersistencePlatform`. Rust-visible permissions cannot prove DACL
preservation, and the workspace forbids local unsafe Rust needed by raw Win32
bindings. Opening and read-only sessions remain supported; dirty save creates no
temp, backup, or primary write on Windows.

### M3.1 Windows replacement evaluation

The 2026-08-19 M3.1 evaluation did not enable Windows writes. Microsoft
[documents that a successful `ReplaceFileW`
call](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew)
preserves the replaced file's
creation time, DACL, security resource attributes, EFS encryption, compression,
and named streams not already present in the replacement. That is the required
metadata behavior, and calls that ignore merge or ACL errors are unacceptable.
However, the same contract documents `ERROR_UNABLE_TO_MOVE_REPLACEMENT` and
`ERROR_UNABLE_TO_MOVE_REPLACEMENT_2` failure states in which the replaced file
can cease to exist at its canonical name and remain under another name. That
does not satisfy Nian Pass's always-present canonical-path and ordinary failure
invariants.

Rust 1.97.1's Windows `std::fs::rename` implementation was also inspected. It
uses `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` and, for an access-denied case,
falls back to `SetFileInformationByHandle(FileRenameInfoEx)`. These operations
rename the prepared file identity; they do not provide `ReplaceFileW`'s
documented destination-DACL, EFS, compression, and named-stream merge contract.
They therefore cannot safely replace a restrictive vault with a temp that may
have inherited a broader directory DACL.

Safe public wrappers were evaluated rather than introducing local Win32 FFI.
`winsafe` 0.0.28 exposes `ReplaceFileW`, but accepts UTF-8 strings rather than
arbitrary Windows paths and cannot strengthen the operating-system failure
contract. `atomic-write-file` 0.3.1, `atomicwrites` 0.4.4, and `safe-write` 0.2.0
use rename/`MoveFileExW` on Windows and do not preserve the required destination
security metadata. `windows-acl` 0.3.0 can inspect or modify ACLs but does not
supply an atomic replacement primitive, and applying a DACL after publication
would create an unacceptable exposure window. No dependency was added.

The first-backup case remains a separate blocker: publishing a new `.bak` must
not expose a temp with broader inherited access than the primary, and this must
be established before its name becomes visible. The current Forgejo
infrastructure has a Windows cross-compilation job but no native Windows runner,
so destination and backup DACL behavior cannot receive the required runtime
evidence here. Until an operation satisfies both the replacement failure
contract and first-backup security contract, followed by native DACL tests,
`SAVE_SUPPORTED` remains false on Windows.

## Platform behavior

| Platform | Atomic replacement implementation | Parent directory sync | Runtime evidence |
|---|---|---|---|
| Linux/Unix | Same-filesystem `std::fs::rename` replacement; destination is never removed first | Directory handle `sync_all` | Linux tests passed |
| macOS | Unix replacement and directory sync implementation | Directory handle `sync_all` | Not runtime tested |
| Windows | Write persistence explicitly unsupported after M3.1 primitive evaluation; typed fail-closed error before transaction I/O | Not applicable while writes are disabled | Local `x86_64-pc-windows-gnu --all-targets` check passed and CI gate configured; native runtime and DACL behavior not tested |

If the replacement primitive fails on a filesystem, save fails safely. M3 does
not downgrade to truncating the primary. Cloud-synchronized folders, network
shares, and removable filesystems receive no special fallback.

## Failure boundaries

Credential mismatch, temp creation, serialization, flush, temp sync, temp
reopen, semantic mismatch, second/third fingerprint conflict, backup write,
backup verification, primary replacement failure, and injected pre-replacement
failures all leave the primary's exact bytes and an existing backup unchanged,
and leave the session dirty. RAII cleanup removes abandoned save and backup
temps where possible without hiding the primary error.

Once atomic primary replacement succeeds, an error is post-commit. M3 still
reopens and semantically verifies the final target and updates the fingerprint
and saved revision where possible. In particular, if primary replacement
succeeds but Unix parent-directory sync fails, `DurabilityUncertain` reports
that the new content is currently present and verified but its survival across
power loss is uncertain; the session is clean because disk currently matches
memory. A final-generation conflict or verification failure is also explicitly
post-commit: no baseline is accepted and the session remains dirty/unreconciled.

## Concurrency and lifecycle limitations

Fingerprint validation is optimistic external-modification detection. KeePassXC,
OneDrive, Google Drive, Dropbox, and other writers do not honor a Nian-specific
lock, so an unavoidable race remains between the last fingerprint check and the
filesystem replacement operation. M3 adds no naive `.lock` file and makes no
multi-writer or merge guarantee. A detected conflict keeps both external bytes
and dirty in-memory edits; it does not auto-reload or merge.

`VaultSession::lock(self)` and ordinary drop release the decrypted
`KdbxDocument`; neither autosaves. Dropping a dirty session discards its
in-memory edits. Although `SecretString` zeroizes its owned buffer, the complete
`keepass-rs::Database` contains ordinary allocated strings. M3 cannot guarantee
immediate physical erasure of every prior plaintext allocation.

There is no Save As/export, master-password rotation, keyfile support, automatic
backup recovery, file watcher, autosave timer, cloud merge, or background task.
