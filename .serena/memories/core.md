# Nian Pass

- The encrypted `.kdbx` file is the source of truth. Rust owns KDBX parsing, vault/session authority, persistence, sync merging, and native security decisions; Tauri/React presents reviewed commands and DTOs.
- Source map: `crates/kdbx`, `crates/vault-core`, `crates/vault-session`; desktop commands/state under `apps/desktop/src-tauri/src`; UI under `apps/desktop/src`; provider-independent semantic merge in `crates/vault-sync`; sync orchestration in `crates/sync-engine`; Android/iOS and browser have focused memories.
- Keep boundaries fail-closed and preserve vault bytes, WAL/recovery state, enrollment semantics, and separate credentials. Linux cross-compilation is not OS runtime proof.
- Read `mem:tech_stack` for build layout, `mem:conventions` for code/security patterns, `mem:suggested_commands` for common commands, `mem:task_completion` for evidence standards, `mem:security/core` for local vault safety, and `mem:sync/core` for remote-sync invariants.
- For platform authority and trust boundaries read `mem:mobile/core` and `mem:browser/core`.
- Canonical references: `docs/architecture.md`, `docs/threat-model.md`, `docs/write-safety.md`, `docs/quality.md`.