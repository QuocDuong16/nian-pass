use sync_provider_core::CiphertextDigest;
use thiserror::Error;
use vault_core::SecretString;

use crate::SourceBinding;

/// Clean exact local generation captured before network work.
pub struct LocalSnapshot {
    source: SourceBinding,
    authority_token: String,
    ciphertext: Vec<u8>,
    digest: CiphertextDigest,
}

impl LocalSnapshot {
    /// Constructs a clean local snapshot. The authority token is process-local
    /// and lets adapters reject Lock, source switch, or session replacement.
    #[must_use]
    pub fn new(source: SourceBinding, authority_token: String, ciphertext: Vec<u8>) -> Self {
        let digest = CiphertextDigest::of(&ciphertext);
        Self {
            source,
            authority_token,
            ciphertext,
            digest,
        }
    }

    /// Stable private identity of the selected local source.
    #[must_use]
    pub const fn source(&self) -> &SourceBinding {
        &self.source
    }

    /// Process-local session/generation authority.
    #[must_use]
    pub fn authority_token(&self) -> &str {
        &self.authority_token
    }

    /// Exact encrypted local KDBX bytes.
    #[must_use]
    pub fn ciphertext(&self) -> &[u8] {
        &self.ciphertext
    }

    /// Exact ciphertext identity.
    #[must_use]
    pub const fn digest(&self) -> &CiphertextDigest {
        &self.digest
    }
}

/// Stable local precondition/commit failures.
#[derive(Debug, Error)]
#[non_exhaustive]
pub enum LocalCommitError {
    /// No unlocked desktop session remains.
    #[error("the vault is locked")]
    Locked,
    /// A frontend or Rust draft makes implicit persistence unsafe.
    #[error("save before syncing")]
    Dirty,
    /// Save, external edit, source switch, or session replacement won the race.
    #[error("the local vault changed during synchronization")]
    Changed,
    /// Exact safe replacement is unavailable on this platform.
    #[error("safe local replacement is unavailable")]
    Unsupported,
    /// The local encrypted file could not be captured or committed safely.
    #[error("the local vault operation failed")]
    Failed,
}

/// Narrow desktop-local boundary. Implementations lock application state only
/// while capturing or committing, never while the engine awaits network I/O.
pub trait LocalVault: Send + Sync {
    /// Captures an exact clean encrypted generation and local authority token.
    fn capture_clean(&self) -> Result<LocalSnapshot, LocalCommitError>;

    /// Atomically installs exact encrypted bytes only if `expected` is still the
    /// current clean source/session generation.
    fn replace_if_unchanged(
        &self,
        expected: &LocalSnapshot,
        ciphertext: &[u8],
        master_password: &SecretString,
    ) -> Result<(), LocalCommitError>;
}
