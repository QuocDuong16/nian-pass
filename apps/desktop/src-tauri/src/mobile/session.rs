#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use std::{
    fs::{self, File, OpenOptions},
    io::{BufWriter, Read, Write},
    path::Path,
};

use kdbx::{EntryTotpCode, KdbxDocument, KdbxError};
use vault_core::{EntryId, SecretBytes, SecretString};

use crate::dto::{
    EntryAttachmentSummaryDto, EntryDetailDto, EntryHistoryDto, MobileVaultSnapshotDto,
};

const MAX_MOBILE_ATTACHMENT_BYTES: u64 = 64 * 1024 * 1024;

use super::{
    MobileError,
    generation::{EncryptedGeneration, MobileSourceHandle, MobileSourceRef},
    mutations::{map_mutation_error, require_id},
};

pub(crate) struct PreparedMobileSave {
    pub(super) operation: u64,
    pub(super) revision: u64,
    pub(super) baseline: String,
    pub(super) candidate: String,
}

/// Decrypted mobile state with KDBX semantics and opaque source identity only.
pub(super) struct MobileVaultSession {
    pub(super) document: KdbxDocument,
    source: MobileSourceRef,
    saved_revision: u64,
}

impl MobileVaultSession {
    pub(super) fn open_candidate(
        staged_path: &Path,
        handle: MobileSourceHandle,
        writable: bool,
        credential: &SecretString,
    ) -> Result<(Self, MobileVaultSnapshotDto), MobileError> {
        let before = EncryptedGeneration::from_path(staged_path)
            .map_err(|_| MobileError::UnsupportedVault)?;
        let document =
            KdbxDocument::open(staged_path, credential.expose_secret()).map_err(map_open_error)?;
        let after = EncryptedGeneration::from_path(staged_path)
            .map_err(|_| MobileError::UnsupportedVault)?;
        if before != after {
            return Err(MobileError::UnsupportedVault);
        }
        let saved_revision = document.revision();
        let snapshot = snapshot_for(&document, saved_revision)?;
        Ok((
            Self {
                document,
                source: MobileSourceRef {
                    handle,
                    baseline: before,
                    writable,
                },
                saved_revision,
            },
            snapshot,
        ))
    }

    pub(super) fn snapshot(&self) -> Result<MobileVaultSnapshotDto, MobileError> {
        snapshot_for(&self.document, self.saved_revision)
    }

    #[cfg(any(target_os = "ios", test))]
    pub(super) fn password_identities(
        &self,
    ) -> Result<Vec<credential_provider_core::PasswordIdentity>, MobileError> {
        credential_provider_core::password_identities(&self.document)
            .map_err(|_| MobileError::Internal)
    }

    pub(super) fn is_dirty(&self) -> bool {
        self.document.has_changes_since(self.saved_revision)
    }
    pub(super) fn source_handle(&self) -> &MobileSourceHandle {
        &self.source.handle
    }
    pub(super) fn writable(&self) -> bool {
        self.source.writable
    }

    pub(super) fn entry_detail(&self, entry_id: &str) -> Result<EntryDetailDto, MobileError> {
        require_id(entry_id)?;
        let id = EntryId::new(entry_id);
        let projection = self
            .document
            .projection()
            .map_err(|_| MobileError::Internal)?;
        let entry = projection
            .find_entry(&id)
            .ok_or(MobileError::EntryNotFound)?;
        let fields = self
            .document
            .custom_fields(&id)
            .map_err(map_mutation_error)?;
        Ok(EntryDetailDto::from_entry(entry, &fields))
    }

    pub(super) fn entry_history(&self, entry_id: &str) -> Result<EntryHistoryDto, MobileError> {
        require_id(entry_id)?;
        let history = self
            .document
            .entry_history(&EntryId::new(entry_id))
            .map_err(map_mutation_error)?;
        Ok(EntryHistoryDto::from_history(&history))
    }

    pub(super) fn entry_attachments(
        &self,
        entry_id: &str,
    ) -> Result<Vec<EntryAttachmentSummaryDto>, MobileError> {
        require_id(entry_id)?;
        self.document
            .entry_attachments(&EntryId::new(entry_id))
            .map(|items| items.iter().map(Into::into).collect())
            .map_err(map_mutation_error)
    }

    pub(super) fn import_entry_attachment(
        &mut self,
        entry_id: &str,
        name: &str,
        staged_path: &Path,
    ) -> Result<(), MobileError> {
        require_id(entry_id)?;
        if name.is_empty() {
            return Err(MobileError::InvalidRequest);
        }
        let metadata = fs::metadata(staged_path).map_err(|_| MobileError::Internal)?;
        if !metadata.is_file() || metadata.len() > MAX_MOBILE_ATTACHMENT_BYTES {
            return Err(MobileError::InvalidRequest);
        }
        let mut bytes = Vec::with_capacity(usize::try_from(metadata.len()).unwrap_or(0));
        File::open(staged_path)
            .map_err(|_| MobileError::Internal)?
            .take(MAX_MOBILE_ATTACHMENT_BYTES + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| MobileError::Internal)?;
        if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > MAX_MOBILE_ATTACHMENT_BYTES {
            return Err(MobileError::InvalidRequest);
        }
        self.document
            .add_entry_attachment(&EntryId::new(entry_id), name, &SecretBytes::new(bytes))
            .map_err(map_mutation_error)
    }

    pub(super) fn export_entry_attachment(
        &self,
        entry_id: &str,
        name: &str,
        candidate_path: &Path,
    ) -> Result<(), MobileError> {
        require_id(entry_id)?;
        if name.is_empty() {
            return Err(MobileError::InvalidRequest);
        }
        let bytes = self
            .document
            .entry_attachment_bytes(&EntryId::new(entry_id), name)
            .map_err(map_mutation_error)?;
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(candidate_path)
            .map_err(|_| MobileError::Internal)?;
        file.write_all(bytes.expose_secret())
            .and_then(|()| file.sync_all())
            .map_err(|_| MobileError::Internal)
    }

    pub(super) fn entry_totp_code(&self, entry_id: &str) -> Result<EntryTotpCode, MobileError> {
        require_id(entry_id)?;
        self.document
            .entry_totp_code(&EntryId::new(entry_id))
            .map_err(map_mutation_error)
    }

    pub(super) fn entry_secret(
        &self,
        entry_id: &str,
        read: impl FnOnce(&KdbxDocument, &EntryId) -> Result<Option<SecretString>, KdbxError>,
    ) -> Result<SecretString, MobileError> {
        require_id(entry_id)?;
        read(&self.document, &EntryId::new(entry_id))
            .map_err(map_mutation_error)?
            .ok_or(MobileError::SecretUnavailable)
    }

    pub(super) fn entry_custom_field(
        &self,
        entry_id: &str,
        name: &str,
    ) -> Result<SecretString, MobileError> {
        require_id(entry_id)?;
        self.document
            .entry_custom_field(&EntryId::new(entry_id), name)
            .map_err(map_mutation_error)?
            .ok_or(MobileError::SecretUnavailable)
    }

    pub(super) fn prepare_save(
        &self,
        operation: u64,
        current_path: &Path,
        candidate_path: &Path,
        credential: &SecretString,
    ) -> Result<PreparedMobileSave, MobileError> {
        if !self.source.writable {
            return Err(MobileError::PersistenceUnsupported);
        }
        if !self.is_dirty() {
            return Err(MobileError::InvalidRequest);
        }
        let current_generation = EncryptedGeneration::from_path(current_path)?;
        if current_generation != self.source.baseline {
            return Err(MobileError::ExternalChange);
        }
        KdbxDocument::open(current_path, credential.expose_secret()).map_err(
            |error| match error {
                KdbxError::InvalidCredentials => MobileError::SaveAuthenticationFailed,
                _ => MobileError::SaveFailed,
            },
        )?;

        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(candidate_path)
            .map_err(|_| MobileError::SaveFailed)?;
        let mut writer = BufWriter::new(file);
        self.document
            .save_to_writer(&mut writer, credential.expose_secret())
            .map_err(|_| MobileError::SaveFailed)?;
        writer.flush().map_err(|_| MobileError::SaveFailed)?;
        writer
            .into_inner()
            .map_err(|_| MobileError::SaveFailed)?
            .sync_all()
            .map_err(|_| MobileError::SaveFailed)?;
        let reopened = KdbxDocument::open(candidate_path, credential.expose_secret())
            .map_err(|_| MobileError::SaveFailed)?;
        self.document
            .verify_semantic_equivalence(&reopened)
            .map_err(|_| MobileError::SaveFailed)?;
        let candidate_generation = EncryptedGeneration::from_path(candidate_path)?;
        Ok(PreparedMobileSave {
            operation,
            revision: self.document.revision(),
            baseline: self.source.baseline.native_identity(),
            candidate: candidate_generation.native_identity(),
        })
    }

    pub(super) fn mark_verified_saved(
        &mut self,
        prepared: &PreparedMobileSave,
        read_back_path: &Path,
        credential: &SecretString,
    ) -> Result<MobileVaultSnapshotDto, MobileError> {
        if self.document.revision() != prepared.revision {
            return Err(MobileError::SaveUncertain);
        }
        let final_generation = EncryptedGeneration::from_path(read_back_path)
            .map_err(|_| MobileError::SaveUncertain)?;
        if final_generation.native_identity() != prepared.candidate {
            return Err(MobileError::SaveUncertain);
        }
        let reopened = KdbxDocument::open(read_back_path, credential.expose_secret())
            .map_err(|_| MobileError::SaveUncertain)?;
        self.document
            .verify_semantic_equivalence(&reopened)
            .map_err(|_| MobileError::SaveUncertain)?;
        self.source.baseline = final_generation;
        self.saved_revision = self.document.revision();
        self.snapshot()
    }

    pub(super) fn reload_candidate(
        &mut self,
        staged_path: &Path,
        credential: &SecretString,
    ) -> Result<MobileVaultSnapshotDto, MobileError> {
        let before =
            EncryptedGeneration::from_path(staged_path).map_err(|_| MobileError::ReloadFailed)?;
        let candidate = KdbxDocument::open(staged_path, credential.expose_secret()).map_err(
            |error| match error {
                KdbxError::InvalidCredentials => MobileError::ReloadAuthenticationFailed,
                _ => MobileError::ReloadFailed,
            },
        )?;
        let after =
            EncryptedGeneration::from_path(staged_path).map_err(|_| MobileError::ReloadFailed)?;
        if before != after {
            return Err(MobileError::ReloadFailed);
        }
        let saved_revision = candidate.revision();
        let snapshot = snapshot_for(&candidate, saved_revision)?;
        self.document = candidate;
        self.source.baseline = before;
        self.saved_revision = saved_revision;
        Ok(snapshot)
    }
}

fn snapshot_for(
    document: &KdbxDocument,
    saved_revision: u64,
) -> Result<MobileVaultSnapshotDto, MobileError> {
    document
        .projection()
        .map(|vault| {
            MobileVaultSnapshotDto::from_vault(
                &vault,
                document.has_changes_since(saved_revision),
                document.recycle_bin_enabled(),
                document
                    .recycle_bin_group_id()
                    .map(|id| id.as_str().to_owned()),
            )
        })
        .map_err(|_| MobileError::Internal)
}

fn map_open_error(error: KdbxError) -> MobileError {
    match error {
        KdbxError::InvalidCredentials => MobileError::UnlockFailed,
        KdbxError::InvalidKdbx | KdbxError::UnsupportedFormat | KdbxError::Conversion(_) => {
            MobileError::UnsupportedVault
        }
        _ => MobileError::Internal,
    }
}

#[cfg(test)]
mod tests {
    use super::MobileVaultSession;
    use crate::mobile::{generation::MobileSourceHandle, mutations::MobileUpdateEntryRequest};
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::atomic::{AtomicU64, Ordering},
    };
    use vault_core::SecretString;

    const PASSWORD: &str = "demopass";
    static NEXT: AtomicU64 = AtomicU64::new(0);

    fn staged_fixture() -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!(
            "nian-pass-mobile-session-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).expect("test directory");
        let staged = root.join("source.kdbx");
        fs::copy(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx"),
            &staged,
        )
        .expect("stage fixture");
        (root, staged)
    }

    fn dirty_session(source: &Path) -> (MobileVaultSession, SecretString) {
        let credential = SecretString::new(PASSWORD.to_owned());
        let (mut session, initial) = MobileVaultSession::open_candidate(
            source,
            MobileSourceHandle::new("0123456789abcdef0123456789abcdef".to_owned()).expect("handle"),
            true,
            &credential,
        )
        .expect("open");
        let entry = initial.entries.first().expect("entry").id.clone();
        session
            .update_entry(MobileUpdateEntryRequest {
                entry_id: entry,
                title: Some("M5.2 edited".to_owned()),
                username: None,
                url: None,
                password: None,
                notes: None,
                expires: None,
                expiry_unix_seconds: None,
                totp_enabled: None,
                totp_uri: None,
                icon: None,
            })
            .expect("mutation");
        (session, credential)
    }

    #[test]
    fn mutation_prepare_and_verified_commit_tracks_dirty_revision() {
        let (root, source) = staged_fixture();
        let (mut session, credential) = dirty_session(&source);
        assert!(session.snapshot().expect("snapshot").dirty);
        let candidate = root.join("candidate.kdbx");
        let prepared = session
            .prepare_save(7, &source, &candidate, &credential)
            .expect("prepare");
        fs::copy(&candidate, &source).expect("fake provider commit");
        assert!(
            !session
                .mark_verified_saved(&prepared, &source, &credential)
                .expect("verified commit")
                .dirty
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn wrong_password_and_external_generation_never_create_candidate() {
        let (root, source) = staged_fixture();
        let (session, credential) = dirty_session(&source);
        let wrong = root.join("wrong.kdbx");
        assert!(matches!(
            session.prepare_save(1, &source, &wrong, &SecretString::new("wrong".to_owned())),
            Err(super::MobileError::SaveAuthenticationFailed)
        ));
        assert!(!wrong.exists());
        fs::write(&source, b"different encrypted generation").expect("replace source");
        let changed = root.join("changed.kdbx");
        assert!(matches!(
            session.prepare_save(2, &source, &changed, &credential),
            Err(super::MobileError::ExternalChange)
        ));
        assert!(!changed.exists());
        assert!(session.snapshot().expect("snapshot").dirty);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stale_save_completion_cannot_mark_a_newer_revision_clean() {
        let (root, source) = staged_fixture();
        let (mut session, credential) = dirty_session(&source);
        let entry = session
            .snapshot()
            .expect("snapshot")
            .entries
            .first()
            .expect("entry")
            .id
            .clone();
        let candidate = root.join("stale-candidate.kdbx");
        let prepared = session
            .prepare_save(9, &source, &candidate, &credential)
            .expect("prepare revision N");

        session
            .update_entry(MobileUpdateEntryRequest {
                entry_id: entry,
                title: Some("revision N plus one".to_owned()),
                username: None,
                url: None,
                password: None,
                notes: None,
                expires: None,
                expiry_unix_seconds: None,
                totp_enabled: None,
                totp_uri: None,
                icon: None,
            })
            .expect("newer mutation");
        fs::copy(&candidate, &source).expect("fake stale provider completion");

        assert!(matches!(
            session.mark_verified_saved(&prepared, &source, &credential),
            Err(super::MobileError::SaveUncertain)
        ));
        assert!(session.snapshot().expect("snapshot").dirty);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reload_swaps_only_a_fully_opened_generation_and_clean_save_is_rejected() {
        let (root, source) = staged_fixture();
        let credential = SecretString::new(PASSWORD.to_owned());
        let (mut session, initial) = MobileVaultSession::open_candidate(
            &source,
            MobileSourceHandle::new("0123456789abcdef0123456789abcdef".to_owned()).expect("handle"),
            true,
            &credential,
        )
        .expect("open");
        assert!(!initial.dirty);
        assert!(matches!(
            session.prepare_save(1, &source, &root.join("clean.kdbx"), &credential),
            Err(super::MobileError::InvalidRequest)
        ));
        let before = session.snapshot().expect("before");
        assert!(matches!(
            session.reload_candidate(&source, &SecretString::new("wrong".to_owned())),
            Err(super::MobileError::ReloadAuthenticationFailed)
        ));
        assert!(session.snapshot().expect("retained") == before);
        assert!(
            !session
                .reload_candidate(&source, &credential)
                .expect("verified reload")
                .dirty
        );
        let _ = fs::remove_dir_all(root);
    }
}
