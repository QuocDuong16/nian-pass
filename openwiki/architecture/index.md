# Files

- [Nian Pass — Architecture](overview.md) - Workspace structure, crate dependency direction, domain model, architecture invariants, security boundaries, KDBX adapter design, desktop app design, three-way sync engine, and verified persistence for Nian Pass.
- [Verified Persistence](persistence.md) - Multi-stage verified atomic save protocol for local KDBX vault sessions, including fingerprint verification, backup strategy, and platform limitations.
- [Three-Way Sync Engine](sync-engine.md) - Provider-independent three-way semantic merge engine for KDBX documents, including conflict types, merge model, and validation invariants.
