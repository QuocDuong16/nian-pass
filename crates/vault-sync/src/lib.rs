//! Provider-independent three-way semantic merge orchestration.
//!
//! This crate has no filesystem, network, credential, asynchronous runtime, or
//! cloud-provider responsibility. Complete parsed KDBX state remains sealed in
//! `kdbx`; this crate owns the BASE/LOCAL/REMOTE decision and exposes only
//! dependency-neutral conflict descriptors.

use kdbx::{KdbxDivergentMergeOutcome, KdbxDocument, KdbxError, KdbxVersion, SyncConflictSet};
use thiserror::Error;

pub use kdbx::{
    SyncConflict as MergeConflict, SyncConflictField as MergeConflictField,
    SyncConflictFieldKind as MergeConflictFieldKind, SyncConflictKind as MergeConflictKind,
    SyncConflictObject as MergeConflictObject,
};

/// Complete result of comparing one common base with local and remote state.
pub enum MergeOutcome {
    /// Local and remote already have identical complete parsed semantics.
    Equivalent,
    /// Remote still equals BASE, so LOCAL is the safe successor.
    FastForwardLocal,
    /// Local still equals BASE, so REMOTE is the safe successor.
    FastForwardRemote,
    /// Both sides diverged and every change was synthesized without ambiguity.
    Merged(MergedDocument),
    /// At least one ambiguous change exists; no merged document was produced.
    Conflicted(MergeConflictSet),
}

/// An owned, complete KDBX document produced atomically by auto-merge.
pub struct MergedDocument {
    document: Box<KdbxDocument>,
}

impl MergedDocument {
    /// Borrows the complete opaque document for verification or persistence.
    #[must_use]
    pub const fn document(&self) -> &KdbxDocument {
        &self.document
    }

    /// Consumes the wrapper and returns the complete opaque KDBX document.
    #[must_use]
    pub fn into_document(self) -> KdbxDocument {
        *self.document
    }
}

/// A non-empty set of structured conflicts without competing plaintext values.
pub struct MergeConflictSet {
    inner: SyncConflictSet,
}

impl MergeConflictSet {
    /// Number of detected conflicts.
    #[must_use]
    pub fn len(&self) -> usize {
        self.inner.len()
    }

    /// Conflict analysis never constructs an empty set.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }

    /// Iterates structured conflict descriptors without exposing values.
    pub fn iter(&self) -> impl Iterator<Item = &MergeConflict> {
        self.inner.iter()
    }
}

/// Errors that prevent meaningful three-way analysis.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum MergeError {
    /// Inputs do not use the same exact KDBX format version.
    #[error("the sync inputs use incompatible KDBX versions")]
    VersionMismatch,

    /// At least one generation violates required UUID/tree invariants.
    #[error("a sync input is internally inconsistent")]
    InvalidInput,

    /// Synthesized output is restricted to the proven KDBX 4.1 writer.
    #[error("this KDBX version cannot produce a merged vault")]
    UnsupportedVersion,

    /// The KDBX adapter rejected inconsistent or unrepresentable input.
    #[error("the vault generations could not be merged safely")]
    Kdbx(#[source] KdbxError),
}

/// Three-way merges already-opened KDBX documents without mutating any input.
pub fn merge(
    base: &KdbxDocument,
    local: &KdbxDocument,
    remote: &KdbxDocument,
) -> Result<MergeOutcome, MergeError> {
    if base.version() != local.version() || base.version() != remote.version() {
        return Err(MergeError::VersionMismatch);
    }
    base.validate_for_sync()
        .and_then(|()| local.validate_for_sync())
        .and_then(|()| remote.validate_for_sync())
        .map_err(|_| MergeError::InvalidInput)?;

    if local.semantically_equals(remote) {
        return Ok(MergeOutcome::Equivalent);
    }
    if remote.semantically_equals(base) {
        return Ok(MergeOutcome::FastForwardLocal);
    }
    if local.semantically_equals(base) {
        return Ok(MergeOutcome::FastForwardRemote);
    }

    if base.version() != (KdbxVersion::Kdbx4 { minor: 1 }) {
        return Err(MergeError::UnsupportedVersion);
    }

    match KdbxDocument::merge_divergent(base, local, remote).map_err(MergeError::Kdbx)? {
        KdbxDivergentMergeOutcome::Merged(document) => {
            Ok(MergeOutcome::Merged(MergedDocument { document }))
        }
        KdbxDivergentMergeOutcome::Conflicted(inner) => {
            Ok(MergeOutcome::Conflicted(MergeConflictSet { inner }))
        }
    }
}
