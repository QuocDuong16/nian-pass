use std::{
    fs,
    io::{BufWriter, Write},
    path::Path,
};

use kdbx::KdbxDocument;
use vault_core::SecretString;

use super::{
    SessionError, VaultSession, canonical_regular_file, open_private_new_file,
    open_stable_document, platform,
};

impl VaultSession {
    /// Creates a new KDBX vault without overwriting an existing target, verifies
    /// the serialized file by reopening it, and returns the unlocked session.
    pub fn create(
        path: impl AsRef<Path>,
        vault_name: &str,
        credential: &SecretString,
    ) -> Result<Self, SessionError> {
        let path = path.as_ref();
        let parent = path.parent().ok_or(SessionError::UnsupportedPath)?;
        let document = KdbxDocument::new(vault_name);
        let result = (|| {
            let mut file = open_private_new_file(path).map_err(SessionError::CreateTarget)?;
            {
                let mut writer = BufWriter::new(&mut file);
                document
                    .save_to_writer(&mut writer, credential.expose_secret())
                    .map_err(SessionError::Kdbx)?;
                writer.flush().map_err(SessionError::CreateTarget)?;
            }
            file.sync_all().map_err(SessionError::CreateTarget)?;
            drop(file);
            platform::sync_parent(parent).map_err(SessionError::CreateTarget)?;

            let canonical = canonical_regular_file(path)?;
            let (reopened, source_fingerprint) = open_stable_document(&canonical, credential)?;
            document
                .verify_semantic_equivalence(&reopened)
                .map_err(SessionError::Kdbx)?;
            let saved_revision = reopened.revision();
            Ok(Self {
                path: canonical,
                document: reopened,
                source_fingerprint,
                saved_revision,
            })
        })();
        if result.is_err() {
            let _ = fs::remove_file(path);
        }
        result
    }
}
