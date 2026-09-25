use std::{
    fs::{self, File},
    io::{BufWriter, Write},
    path::Path,
};

use kdbx::KdbxDocument;
use vault_core::SecretString;

use super::{
    CREATE_TEMP_PREFIX, ManagedTemp, SessionError, VaultSession, canonical_regular_file,
    file_identity, open_stable_document, platform,
};

impl VaultSession {
    /// Creates a new KDBX vault without overwriting an existing target, verifies
    /// the prepared file before publishing it, and returns the unlocked session.
    pub fn create(
        path: impl AsRef<Path>,
        vault_name: &str,
        credential: &SecretString,
    ) -> Result<Self, SessionError> {
        Self::create_with_publish_hook(path, vault_name, credential, |_| Ok(()))
    }

    pub(super) fn create_with_publish_hook(
        path: impl AsRef<Path>,
        vault_name: &str,
        credential: &SecretString,
        after_publish: impl FnOnce(&Path) -> Result<(), SessionError>,
    ) -> Result<Self, SessionError> {
        let requested_path = path.as_ref();
        let file_name = requested_path
            .file_name()
            .ok_or(SessionError::UnsupportedPath)?;
        let requested_parent = requested_path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        let parent = fs::canonicalize(requested_parent).map_err(SessionError::CreateTarget)?;
        let parent_metadata = fs::metadata(&parent).map_err(SessionError::CreateTarget)?;
        if !parent_metadata.is_dir() {
            return Err(SessionError::UnsupportedPath);
        }

        let target = parent.join(file_name);
        let document = KdbxDocument::new(vault_name);
        let mut prepared = ManagedTemp::create(&parent, CREATE_TEMP_PREFIX)?;
        {
            let mut writer = BufWriter::new(prepared.file_mut()?);
            document
                .save_to_writer(&mut writer, credential.expose_secret())
                .map_err(SessionError::Kdbx)?;
            writer.flush().map_err(SessionError::CreateTarget)?;
        }
        prepared
            .file_mut()?
            .sync_all()
            .map_err(SessionError::CreateTarget)?;

        let prepared_path = canonical_regular_file(prepared.path())?;
        ensure_prepared_identity(&mut prepared, &prepared_path)?;
        let (prepared_document, prepared_fingerprint) =
            open_stable_document(&prepared_path, credential)?;
        ensure_prepared_identity(&mut prepared, &prepared_path)?;
        document
            .verify_semantic_equivalence(&prepared_document)
            .map_err(SessionError::Kdbx)?;

        // `hard_link` publishes the verified file under a new name without
        // replacing an existing target. Failure cleanup only owns the random
        // prepared path; it never removes the user-selected target path.
        fs::hard_link(&prepared_path, &target).map_err(SessionError::CreateTarget)?;
        ensure_prepared_identity(&mut prepared, &target)?;
        platform::sync_parent(&parent).map_err(SessionError::CreateTarget)?;
        after_publish(&target)?;

        ensure_prepared_identity(&mut prepared, &target)?;
        let (reopened, source_fingerprint) = open_stable_document(&target, credential)?;
        ensure_prepared_identity(&mut prepared, &target)?;
        if source_fingerprint != prepared_fingerprint {
            return Err(SessionError::ExternalModificationDetected);
        }
        document
            .verify_semantic_equivalence(&reopened)
            .map_err(SessionError::Kdbx)?;

        let saved_revision = reopened.revision();
        Ok(Self {
            path: target,
            document: reopened,
            source_fingerprint,
            saved_revision,
        })
    }
}

fn ensure_prepared_identity(prepared: &mut ManagedTemp, path: &Path) -> Result<(), SessionError> {
    let file: &File = prepared.file_mut()?;
    if file_identity::matches_open_file(file, path).map_err(SessionError::ReadSource)? {
        Ok(())
    } else {
        Err(SessionError::ExternalModificationDetected)
    }
}
