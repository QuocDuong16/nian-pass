use std::io::{BufWriter, Write};

use kdbx::KdbxCredential;
use vault_core::SecretString;

use super::{
    ManagedTemp, NoopObserver, SAVE_TEMP_PREFIX, SaveObserver, SaveOutcome, SavePhase,
    SessionError, VaultSession, backup_path, map_final_open_error, open_document_with_credential,
    open_stable_document_with_credential_hook, platform, validate_current_target,
};
#[cfg(unix)]
use super::{apply_restricted_permissions, sync_path};

impl VaultSession {
    #[cfg(all(test, unix))]
    pub(super) fn save_with_observer(
        &mut self,
        credential: &SecretString,
        observer: &mut impl SaveObserver,
    ) -> Result<SaveOutcome, SessionError> {
        self.save_with_credential_and_observer(
            KdbxCredential::password(credential.expose_secret()),
            observer,
        )
    }

    fn save_with_credential_and_observer(
        &mut self,
        credential: KdbxCredential<'_>,
        observer: &mut impl SaveObserver,
    ) -> Result<SaveOutcome, SessionError> {
        self.persist_with_credentials(credential, credential, false, observer)
    }

    fn persist_with_credentials(
        &mut self,
        current_credential: KdbxCredential<'_>,
        target_credential: KdbxCredential<'_>,
        force_reencrypt: bool,
        observer: &mut impl SaveObserver,
    ) -> Result<SaveOutcome, SessionError> {
        self.persist_with_credentials_and_platform_support(
            current_credential,
            target_credential,
            force_reencrypt,
            platform::SAVE_SUPPORTED,
            observer,
        )
    }

    #[cfg(all(test, windows))]
    pub(super) fn save_with_windows_candidate_pipeline_for_test(
        &mut self,
        credential: &SecretString,
    ) -> Result<SaveOutcome, SessionError> {
        let credential = KdbxCredential::password(credential.expose_secret());
        self.save_with_windows_candidate_credential_for_test(credential)
    }

    #[cfg(all(test, windows))]
    pub(super) fn save_with_windows_candidate_credential_for_test(
        &mut self,
        credential: KdbxCredential<'_>,
    ) -> Result<SaveOutcome, SessionError> {
        self.persist_with_credentials_and_platform_support(
            credential,
            credential,
            false,
            true,
            &mut NoopObserver,
        )
    }

    fn persist_with_credentials_and_platform_support(
        &mut self,
        current_credential: KdbxCredential<'_>,
        target_credential: KdbxCredential<'_>,
        force_reencrypt: bool,
        save_supported: bool,
        observer: &mut impl SaveObserver,
    ) -> Result<SaveOutcome, SessionError> {
        if !force_reencrypt && !self.is_dirty() {
            return Ok(SaveOutcome::Unchanged);
        }
        if !save_supported {
            return Err(SessionError::UnsupportedPersistencePlatform);
        }
        #[cfg(unix)]
        let source_metadata = validate_current_target(&self.path)?;
        #[cfg(windows)]
        validate_current_target(&self.path)?;
        self.require_source_unchanged()?;
        self.verify_save_credential(current_credential)?;
        let parent = self.path.parent().ok_or(SessionError::UnsupportedPath)?;
        let mut serialized = ManagedTemp::create(parent, SAVE_TEMP_PREFIX)?;
        observer.checkpoint(SavePhase::AfterTempCreate, serialized.path())?;
        {
            let mut writer = BufWriter::new(serialized.file_mut()?);
            observer.serialize(&self.document, &mut writer, target_credential)?;
            writer.flush().map_err(SessionError::WriteTemp)?;
        }
        observer.checkpoint(SavePhase::AfterSerialize, serialized.path())?;
        serialized
            .file_mut()?
            .sync_all()
            .map_err(SessionError::SyncTemp)?;
        serialized.close();
        observer.checkpoint(SavePhase::AfterTempSync, serialized.path())?;
        let reopened_temp = open_document_with_credential(serialized.path(), target_credential)
            .map_err(SessionError::TempVerificationFailed)?;
        self.document
            .verify_semantic_equivalence(&reopened_temp)
            .map_err(SessionError::TempVerificationFailed)?;
        observer.checkpoint(SavePhase::AfterTempVerify, serialized.path())?;
        self.require_source_unchanged()?;
        observer.checkpoint(SavePhase::AfterFinalExternalCheck, &self.path)?;
        #[cfg(unix)]
        {
            apply_restricted_permissions(serialized.path(), &source_metadata)
                .map_err(SessionError::WriteTemp)?;
            sync_path(serialized.path()).map_err(SessionError::SyncTemp)?;
        }
        let backup_path = backup_path(&self.path);
        #[cfg(unix)]
        let prepared_backup = self.prepare_backup(&backup_path, &source_metadata, observer)?;
        // A third check narrows the unavoidable cooperative-locking race and
        // detects changes that happened while the exact backup was prepared.
        observer.checkpoint(SavePhase::BeforeTargetReplace, serialized.path())?;
        self.require_source_unchanged()?;
        #[cfg(unix)]
        observer
            .replace_primary(serialized.path(), &self.path)
            .map_err(SessionError::AtomicReplaceFailed)?;
        #[cfg(windows)]
        platform::replace_windows_with_backup(
            serialized.path(),
            &self.path,
            &backup_path,
            &self.source_fingerprint,
        )?;
        serialized.disarm();
        #[cfg(unix)]
        let post_replace_observer = observer.checkpoint(SavePhase::AfterTargetReplace, &self.path);
        let durability = observer.sync_parent(parent, true);
        let final_open =
            open_stable_document_with_credential_hook(&self.path, target_credential, || {
                observer.checkpoint(SavePhase::AfterFinalDocumentRead, &self.path)
            })
            .map_err(map_final_open_error)?;
        let (final_document, final_fingerprint) = final_open;
        self.document
            .verify_semantic_equivalence(&final_document)
            .map_err(SessionError::FinalVerificationFailed)?;
        self.source_fingerprint = final_fingerprint;
        self.saved_revision = self.document.revision();
        #[cfg(unix)]
        self.commit_backup(prepared_backup, &backup_path, parent, observer)?;
        #[cfg(unix)]
        post_replace_observer?;
        match durability {
            Ok(()) => Ok(SaveOutcome::Saved),
            Err(source) => Err(SessionError::DurabilityUncertain(source)),
        }
    }
    /// Saves a dirty session to its canonical source through a verified atomic
    /// replacement transaction. A clean session performs no filesystem I/O.
    pub fn save(&mut self, credential: &SecretString) -> Result<SaveOutcome, SessionError> {
        self.save_with_credential(KdbxCredential::password(credential.expose_secret()))
    }

    /// Saves with password and/or keyfile credential components.
    pub fn save_with_credential(
        &mut self,
        credential: KdbxCredential<'_>,
    ) -> Result<SaveOutcome, SessionError> {
        self.save_with_credential_and_observer(credential, &mut NoopObserver)
    }

    /// Re-encrypts the canonical vault with a new credential after proving the
    /// currently installed generation still authenticates with the old one.
    ///
    /// Credential rotation is an explicit persistence operation even when the
    /// in-memory document has no ordinary mutations.
    pub fn rotate_credential(
        &mut self,
        current: KdbxCredential<'_>,
        replacement: KdbxCredential<'_>,
    ) -> Result<SaveOutcome, SessionError> {
        self.persist_with_credentials(current, replacement, true, &mut NoopObserver)
    }

    /// Consumes the session and drops its decrypted database representation.
    /// This does not autosave and cannot promise physical erasure of every
    /// plaintext allocation previously owned by `keepass-rs`.
    pub fn lock(self) {}
}
