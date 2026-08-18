# Threat Model

This is the threat model for the M2 secure vault read/edit API foundation. It
records boundaries and assumptions; it is not a claim that Nian Pass is ready
to protect production credentials.

## Secret material

Secret material includes at least:

- Master passwords
- Database decryption keys, including derived keys
- Entry passwords
- Entry notes, which may contain recovery codes, API keys, or private text
- TOTP seeds
- Future protected or secret-bearing custom-field values
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
before display.

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
- Silent KDBX version downgrade or upgrade
- Silent KDF, cipher, or compression changes
- Data loss caused by reconstructing a database from an incomplete projection
- Compromised supply-chain dependencies
- Interoperability failures hidden by parser/writer self-roundtrips
- External compatibility commands hanging or failing non-interactively
- Compatibility-test credential or decrypted-content leakage
- Plaintext exposure through compatibility-test temporary files

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

## M2 controls and gaps

The CLI reads the master password from an interactive terminal without echo and
does not accept a password argument. Its input buffer is cleared on drop, and
the adapter returns generic credential and format errors without embedding the
password. The bulk domain projection exposes privacy-sensitive title, username,
URL, tags, and identifiers plus password/notes presence flags, but excludes
password and notes plaintext, TOTP seeds, attachment contents, history, and
custom-field values.

Password and notes reads require an exact `EntryId` and return one owned
`SecretString`. Its backing `String` is zeroized on drop through `zeroize`; the
type intentionally has no `Debug`, `Display`, `Clone`, serialization, deref, or
implicit string-borrowing implementation. Callers must explicitly invoke
`expose_secret()` for the shortest practical lifetime. The adapter makes one
owned copy from the decrypted dependency representation into `SecretString` and
does not place secrets in errors or logs.

Zeroization reduces accidental residual memory but cannot guarantee removal of
copies made by the operating system, swap, allocator, runtime, compiler, or
dependencies. A compromised process while the vault is unlocked can still read
decrypted dependency state and any explicitly exposed secret.

M2 does not yet address clipboard access, locked-memory allocation, process
hardening, secure file replacement, conflict handling, sync, or dependency
attestation. The project must not claim resistance to those threats yet.

M2 confines experimental mutation to an opaque `KdbxDocument` retaining the
complete `keepass-rs` representation. It never serializes from the incomplete
`Vault` projection, never stores the master password, and looks entries up by
UUID. Title, username, URL, and password edits preserve existing field
protection, while missing password fields default to protected. Same-value and
missing-plus-empty requests avoid history, timestamp, and representation
changes. Typed errors for unknown entries, unsupported write formats,
destination I/O failure, and serialization failure do not contain identifiers,
metadata, or secrets. KDBX 3.1 and 4.0 writes are rejected. The public save API
accepts only a caller-owned writer and cannot perform an in-place path write.

Tests serialize to memory, reopen the result, verify preservation invariants,
exercise wrong credentials and writer failure, and confirm the source fixture
bytes remain unchanged. CI verifies every committed fixture against
`fixtures/kdbx/SHA256SUMS` before running tests.

These controls do not make production save safe. M1.5 has no durable temporary
file, `fsync`, backup, atomic replacement, concurrent-writer detection, or
production conflict handling. See [write safety](write-safety.md) for the
required future filesystem algorithm. `keepass-rs` cannot preserve fields it
does not parse, so neither self-roundtrip nor external verification is a claim
of universal lossless KDBX preservation.

M1.5 invokes a released KeePassXC CLI only from an explicit test harness. The
harness uses one synthetic public fixture credential, supplies it through
stdin rather than process arguments, disables shell tracing, captures command
output, never emits decrypted XML or protected field values, and performs all
writes in a uniquely created temporary directory removed on drop. A shell
timeout bounds the suite. The immutable source fixture is copied before use and
its bytes are checked again after the external round-trip. Local absence is an
explicit skip; the dedicated CI job uses `--require`, so absence is a failure.
