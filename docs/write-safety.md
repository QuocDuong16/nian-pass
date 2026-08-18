# Write Safety

M1 provides only a writer-first, in-memory-capable KDBX 4.1 serialization
foundation. It does not implement saving over an opened vault or replacing a
production file. A successfully serialized buffer is not by itself a safe
filesystem save.

## Future production save algorithm

A later milestone must implement and test the platform-specific equivalent of:

1. Serialize the complete retained KDBX document to a new temporary file on the
   intended destination filesystem.
2. Flush and `fsync` the temporary file where the platform and filesystem make
   that meaningful.
3. Reopen the temporary file with the supplied credentials and verify the
   expected version and preservation invariants.
4. Preserve a recoverable backup or the current file until the new file has
   passed serialization and verification.
5. Atomically rename or replace the destination only where the platform and
   filesystem document that operation as atomic.
6. `fsync` the parent directory where relevant so the directory entry update is
   durable.
7. Never truncate or overwrite the original before successful serialization,
   verification, and backup preparation.

`rename()` is not universally atomic or durable. Local filesystems, network
shares, removable media, mobile document providers, and cloud-synchronized
folders can have different replacement, locking, and crash-consistency
semantics. The future implementation must define its guarantees per supported
platform and reject destinations where it cannot meet them.

## Still required

Production save also needs concurrent-writer detection, explicit conflict
handling, disk-full and permission failure tests, cleanup rules for failed
temporary files, backup retention and recovery behavior, and external
KeePassXC verification. None of those guarantees is implied by M1.
