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

The source fingerprint is `(encrypted byte length, SHA-256)`. Size, mtime,
inode, and other filesystem metadata are not used as conflict identity. The
digest is streamed with a fixed-size buffer and has no `Debug`, `Display`, or
serialization implementation.

## Dirty state

Every opened `KdbxDocument` starts at revision zero. Each successful real
logical mutation increments a saturating process-local counter exactly once;
no-op and failed operations do not increment. Revision is not KDBX data and is
not serialized. `VaultSession` compares that revision with `saved_revision`.

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
   adapter API.
8. Stream-fingerprint the primary a second time and require the original
   baseline.
9. Restrict/preserve applicable source permissions on the verified temp and
   sync it again.
10. Copy the current primary bytes into a second same-directory backup temp
    while streaming its fingerprint. Require that fingerprint to equal the
    source baseline, flush and sync the backup temp, apply restrictive
    permissions, reopen/hash it, then atomically install it as
    `vault.kdbx.bak`.
11. Sync the containing directory after the backup namespace update.
12. Run a third primary fingerprint check immediately before replacement. This
    narrows changes that race with backup preparation; it does not create a
    cross-application lock.
13. Atomically replace the primary with the already verified save temp through
    the single platform replacement helper. The implementation never removes
    the primary first and never falls back to direct truncate/write.
14. Sync the containing directory on Unix.
15. Revalidate and reopen the final primary, then compare its complete parsed
    semantics with the in-memory document.
16. Fingerprint the actual final primary and store that value as the new source
    baseline.
17. Record the current document revision as saved.

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
reserializing an old database. On the first successful A-to-B save it contains
exact A bytes. On the next B-to-C save it atomically rotates to exact B bytes.
An existing backup is never directly truncated. Backup preparation or commit
failure aborts before primary replacement. M3 never promotes or restores the
backup automatically.

On Unix, save and backup temps start at `0600`; installed files retain only the
source owner's read/write permission bits (`source mode & 0600`). This may make
an originally broader mode more restrictive and never broadens it. Rename-based
replacement creates a new inode owned by the saving user; M3 does not attempt
privileged `chown` or promise preservation of every metadata bit. Windows
applies the source's Rust-visible permissions to prepared files; Windows ACL and
hidden-attribute preservation remains runtime-unverified.

## Platform behavior

| Platform | Atomic replacement implementation | Parent directory sync | Runtime evidence |
|---|---|---|---|
| Linux/Unix | Same-filesystem `std::fs::rename` replacement; destination is never removed first | Directory handle `sync_all` | Linux tests passed |
| macOS | Unix replacement and directory sync implementation | Directory handle `sync_all` | Not runtime tested |
| Windows | Rust 1.97 replacement rename (`FileRenameInfoEx` where supported, otherwise `MoveFileExW` replacement semantics); no delete+rename fallback | No stable Rust directory-sync primitive; best effort | `x86_64-pc-windows-gnu` cross-compile passed; not runtime tested |

If the replacement primitive fails on a filesystem, save fails safely. M3 does
not downgrade to truncating the primary. Cloud-synchronized folders, network
shares, and removable filesystems receive no special fallback.

## Failure boundaries

Credential mismatch, temp creation, serialization, flush, temp sync, temp
reopen, semantic mismatch, second/third fingerprint conflict, backup write,
backup verification, backup commit, and injected pre-replacement failures all
leave the primary's exact bytes unchanged and leave the session dirty. RAII
cleanup removes abandoned save and backup temps where possible without hiding
the primary error.

Once atomic primary replacement succeeds, an error is post-commit. M3 still
reopens and semantically verifies the final target and updates the fingerprint
and saved revision where possible. In particular, if primary replacement
succeeds but Unix parent-directory sync fails, `DurabilityUncertain` reports
that the new content is currently present and verified but its survival across
power loss is uncertain; the session is clean because disk currently matches
memory.

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
