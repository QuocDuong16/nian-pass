use std::path::Path;

use vault_core::SecretString;

use super::{SessionError, VaultSession, canonical_regular_file, open_stable_document};

impl VaultSession {
    /// Opens an existing regular vault file into a stable unlocked session.
    /// Final-component symlinks and non-regular files are rejected. The file is
    /// fingerprinted before and after parsing through one handle, and the path
    /// is fingerprinted once more, so an unstable source cannot seed a session.
    pub fn open(path: impl AsRef<Path>, credential: &SecretString) -> Result<Self, SessionError> {
        let path = canonical_regular_file(path.as_ref())?;
        let (document, source_fingerprint) = open_stable_document(&path, credential)?;
        let saved_revision = document.revision();
        Ok(Self {
            path,
            document,
            source_fingerprint,
            saved_revision,
        })
    }
}
