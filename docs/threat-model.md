# Threat Model

This is the initial threat-model skeleton for the M0 read-only foundation. It
records boundaries and assumptions; it is not a claim that Nian Pass is ready
to protect production credentials.

## Assets

- Master passwords
- Derived database keys
- Entry credentials
- TOTP secrets
- Attachments
- Database files
- Key files

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
- Concurrent writes and unresolved conflicts
- Compromised supply-chain dependencies

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

## M0 controls and gaps

The CLI reads the master password from an interactive terminal without echo and
does not accept a password argument. Its input buffer is cleared on drop, and
the adapter returns generic credential and format errors without embedding the
password. The domain projection excludes password, TOTP, notes, attachment
contents, history, and custom fields.

M0 does not yet address clipboard access, locked-memory allocation, process
hardening, secure file writes, conflict handling, sync, or dependency
attestation. The project must not claim resistance to those threats yet.

