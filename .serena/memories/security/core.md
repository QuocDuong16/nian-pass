# Local vault and persistence safety

- The encrypted `.kdbx` file is authoritative; no Nian Pass service receives vault plaintext. Local persistence is optimistic and preservation-first, not a claim of cooperative locking or universal crash proof.
- `VaultSession` binds one canonical local target. It fingerprints complete encrypted bytes, rejects unsafe targets and external generation changes, and marks a dirty save clean only after reopening and semantically verifying the installed candidate.
- Save is a transaction with a same-directory candidate, sync/verification, previous-version backup, and explicit failure/recovery states. Preserve original bytes and recovery evidence; never turn an uncertain write or rollback into success.
- Keep password and key material out of logs, durable application state, non-secret DTO fixtures, and error text. Secret-bearing reads/fills must remain explicit narrow operations with current authority revalidation.
- Ordinary Windows Save remains unavailable until reviewed native ReplaceFileW, identity/DACL, and runtime evidence support it; cross-compilation is not proof.
- References: `crates/vault-session`, `crates/windows-safe-replace`, `docs/write-safety.md`, `docs/threat-model.md`, and desktop/persistence sections of `docs/architecture.md`.