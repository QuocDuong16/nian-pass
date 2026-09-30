# Conventions

- Keep Rust as the vault/KDBX authority; UI and platform layers invoke narrow semantic commands. Shared DTOs are secret-free unless an explicit reviewed operation requires a value, and exact-key validators reject drift.
- Prefer preservation-first, fail-closed behavior for filesystem, sync, authentication, and lifecycle errors. Never turn uncertainty into success or silently replace/retarget a vault.
- Root Cargo dependencies are exact or intentionally bounded; no wildcard registry or production Git dependencies. Workspace policy denies unsafe Rust by default; isolate native unsafe code in reviewed FFI/platform crates and keep `unsafe_op_in_unsafe_fn` denied.
- Use committed synthetic, secret-free fixtures for cross-language contracts. Keep real credentials, vault contents, device identity, and private endpoints out of fixtures, logs, and errors.
- Treat a successful compile or cross-compile as compile evidence only. Keep Windows/iOS/device runtime claims separate.
- Tool versions belong in `mise.toml`; synchronize checked mirrors and regenerate `mise.lock` after pin changes.