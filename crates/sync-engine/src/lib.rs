//! Provider-independent encrypted KDBX synchronization orchestration.
//!
//! `vault-sync` remains the sole semantic merge authority. This crate owns
//! encrypted BASE selection, remote CAS ordering, local preconditions, and the
//! crash-recovery journal; it has no Tauri or concrete network dependency.

mod codec;
mod commit;
mod conflict;
mod engine;
mod error;
mod local;
mod recovery;
mod store;
mod store_io;

pub use conflict::{ConflictChoice, ConflictDescriptor, ConflictOperation};
pub use engine::{SyncCompletion, SyncEngine, SyncOutcome};
pub use error::SyncError;
pub use local::{LocalCommitError, LocalSnapshot, LocalVault};
pub use store::{ProfileId, RecoveryStatus, SourceBinding, StoreError, SyncStore};
