use std::{
    fs,
    io::{Cursor, Write},
};

use kdbx::{KdbxDocument, KdbxError};
use vault_core::SecretString;

#[cfg(unix)]
use super::NoopObserver;

use super::{
    FileFingerprint, ManagedTemp, SAVE_TEMP_PREFIX, SessionError, VaultSession, backup_path,
    fingerprint_path, map_final_open_error, open_document, open_stable_document, platform,
    validate_current_target,
};

/// Exact clean encrypted generation captured for provider-independent sync.
pub struct EncryptedVaultSnapshot {
    ciphertext: Vec<u8>,
    fingerprint: FileFingerprint,
}

impl EncryptedVaultSnapshot {
    /// Exact encrypted KDBX bytes.
    #[must_use]
    pub fn ciphertext(&self) -> &[u8] {
        &self.ciphertext
    }

    /// Strong local precondition for a later atomic replacement.
    #[must_use]
    pub const fn fingerprint(&self) -> &FileFingerprint {
        &self.fingerprint
    }
}

impl VaultSession {
    /// Captures exact clean encrypted bytes without retaining unlock material.
    pub fn capture_encrypted(&self) -> Result<EncryptedVaultSnapshot, SessionError> {
        if self.is_dirty() {
            return Err(SessionError::UnsavedChanges);
        }
        self.require_source_unchanged()?;
        let ciphertext = fs::read(&self.path).map_err(SessionError::ReadSource)?;
        let fingerprint = FileFingerprint::from_reader(&mut Cursor::new(&ciphertext))
            .map_err(SessionError::ReadSource)?;
        self.require_source_unchanged()?;
        if fingerprint != self.source_fingerprint {
            return Err(SessionError::ExternalModificationDetected);
        }
        Ok(EncryptedVaultSnapshot {
            ciphertext,
            fingerprint,
        })
    }

    /// Installs exact already-encrypted KDBX bytes through the same verified
    /// backup and atomic-replacement boundary as Save.
    pub fn replace_encrypted_if_unchanged(
        &mut self,
        expected: &FileFingerprint,
        ciphertext: &[u8],
        credential: &SecretString,
    ) -> Result<(), SessionError> {
        if self.is_dirty() {
            return Err(SessionError::UnsavedChanges);
        }
        if !platform::SYNC_REPLACE_SUPPORTED {
            return Err(SessionError::UnsupportedPersistencePlatform);
        }
        if expected != &self.source_fingerprint {
            return Err(SessionError::ExternalModificationDetected);
        }
        #[cfg(unix)]
        let source_metadata = validate_current_target(&self.path)?;
        #[cfg(windows)]
        validate_current_target(&self.path)?;
        self.require_source_unchanged()?;
        let candidate_document =
            KdbxDocument::open_reader(&mut Cursor::new(ciphertext), credential.expose_secret())
                .map_err(SessionError::TempVerificationFailed)?;
        let candidate_fingerprint = FileFingerprint::from_reader(&mut Cursor::new(ciphertext))
            .map_err(SessionError::WriteTemp)?;

        let parent = self.path.parent().ok_or(SessionError::UnsupportedPath)?;
        let mut prepared = ManagedTemp::create(parent, SAVE_TEMP_PREFIX)?;
        prepared
            .file_mut()?
            .write_all(ciphertext)
            .map_err(SessionError::WriteTemp)?;
        prepared
            .file_mut()?
            .flush()
            .map_err(SessionError::WriteTemp)?;
        prepared
            .file_mut()?
            .sync_all()
            .map_err(SessionError::SyncTemp)?;
        prepared.close();

        let reopened = open_document(prepared.path(), credential)
            .map_err(SessionError::TempVerificationFailed)?;
        candidate_document
            .verify_semantic_equivalence(&reopened)
            .map_err(SessionError::TempVerificationFailed)?;
        if fingerprint_path(prepared.path())? != candidate_fingerprint {
            return Err(SessionError::TempVerificationFailed(
                KdbxError::VerificationFailed,
            ));
        }

        #[cfg(unix)]
        {
            super::apply_restricted_permissions(prepared.path(), &source_metadata)
                .map_err(SessionError::WriteTemp)?;
            super::sync_path(prepared.path()).map_err(SessionError::SyncTemp)?;
        }
        self.require_source_unchanged()?;
        let backup_path = backup_path(&self.path);

        #[cfg(unix)]
        let mut observer = NoopObserver;

        #[cfg(unix)]
        let backup = self.prepare_backup(&backup_path, &source_metadata, &mut observer)?;
        self.require_source_unchanged()?;

        #[cfg(unix)]
        platform::replace_existing(prepared.path(), &self.path)
            .map_err(SessionError::AtomicReplaceFailed)?;

        #[cfg(windows)]
        replace_windows_with_backup(
            prepared.path(),
            &self.path,
            &backup_path,
            &self.source_fingerprint,
        )?;
        prepared.disarm();
        let durability = platform::sync_parent(parent);

        let (final_document, final_fingerprint) =
            open_stable_document(&self.path, credential).map_err(map_final_open_error)?;
        if final_fingerprint != candidate_fingerprint {
            return Err(SessionError::FinalExternalModificationDetected);
        }
        candidate_document
            .verify_semantic_equivalence(&final_document)
            .map_err(SessionError::FinalVerificationFailed)?;
        self.document = final_document;
        self.source_fingerprint = final_fingerprint;
        self.saved_revision = self.document.revision();
        #[cfg(unix)]
        self.commit_backup(backup, &backup_path, parent, &mut observer)?;
        durability.map_err(SessionError::DurabilityUncertain)
    }
}

#[cfg(windows)]
fn replace_windows_with_backup(
    prepared: &std::path::Path,
    destination: &std::path::Path,
    backup: &std::path::Path,
    expected_source: &FileFingerprint,
) -> Result<(), SessionError> {
    super::reject_symlink_if_present(backup).map_err(SessionError::BackupFailed)?;
    let prior_backup = if backup.exists() {
        let parent = backup.parent().ok_or(SessionError::UnsupportedPath)?;
        let path = parent.join(super::random_temp_name(".nian-pass-prior-backup-")?);
        fs::rename(backup, &path).map_err(SessionError::BackupFailed)?;
        Some(path)
    } else {
        None
    };

    match platform::replace_existing_with_backup(prepared, destination, backup) {
        Ok(()) => {
            if super::fingerprint_path_for_backup(backup)? != *expected_source {
                return Err(SessionError::SavedButBackupUpdateFailed(
                    std::io::Error::other(
                        "Windows replacement backup did not preserve the expected source generation",
                    ),
                ));
            }
            if let Some(path) = prior_backup {
                fs::remove_file(path).map_err(SessionError::SavedButBackupUpdateFailed)?;
            }
            Ok(())
        }
        Err(replace_error) => {
            // ReplaceFileW documents one partial error in which the old source
            // has already moved to the requested backup name. Restore the
            // canonical source before restoring the previous backup.
            if !destination.exists() && backup.exists() {
                fs::rename(backup, destination).map_err(SessionError::AtomicReplaceFailed)?;
            }
            if let Some(path) = prior_backup {
                if backup.exists() {
                    return Err(SessionError::AtomicReplaceFailed(replace_error));
                }
                fs::rename(path, backup).map_err(SessionError::AtomicReplaceFailed)?;
            }
            Err(SessionError::AtomicReplaceFailed(replace_error))
        }
    }
}
