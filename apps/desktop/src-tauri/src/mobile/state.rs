use std::{fs, path::PathBuf};

use vault_core::SecretString;

use crate::dto::{EntryDetailDto, SelectedVaultDto, VaultSnapshotDto};

use super::{MobileError, session::MobileReadSession};

struct PendingMobileSelection {
    staged_path: PathBuf,
    file_name: String,
}

impl PendingMobileSelection {
    fn cleanup(&self) -> Result<(), MobileError> {
        match fs::remove_file(&self.staged_path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(MobileError::Internal),
        }
    }
}

impl Drop for PendingMobileSelection {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.staged_path);
    }
}

/// Android orchestration state. It deliberately has no save or mutation API.
pub(crate) struct MobileVaultService {
    pending: Option<PendingMobileSelection>,
    session: Option<MobileReadSession>,
}

impl MobileVaultService {
    pub(crate) const fn new() -> Self {
        Self {
            pending: None,
            session: None,
        }
    }

    pub(crate) fn replace_selection(
        &mut self,
        staged_path: PathBuf,
        file_name: String,
    ) -> Result<SelectedVaultDto, MobileError> {
        let candidate = PendingMobileSelection {
            staged_path,
            file_name,
        };
        if self.session.is_some() {
            return Err(MobileError::Internal);
        }
        let dto = SelectedVaultDto {
            file_name: candidate.file_name.clone(),
        };
        self.pending = Some(candidate);
        Ok(dto)
    }

    pub(crate) fn unlock(
        &mut self,
        credential: &SecretString,
    ) -> Result<VaultSnapshotDto, MobileError> {
        if self.session.is_some() {
            return Err(MobileError::Internal);
        }
        let pending = self.pending.as_ref().ok_or(MobileError::NoVaultSelected)?;
        let (candidate, snapshot) =
            MobileReadSession::open_candidate(&pending.staged_path, credential)?;
        pending.cleanup()?;
        self.pending = None;
        self.session = Some(candidate);
        Ok(snapshot)
    }

    pub(crate) fn snapshot(&self) -> Result<VaultSnapshotDto, MobileError> {
        self.session.as_ref().ok_or(MobileError::Locked)?.snapshot()
    }

    pub(crate) fn entry_detail(&self, entry_id: &str) -> Result<EntryDetailDto, MobileError> {
        self.session
            .as_ref()
            .ok_or(MobileError::Locked)?
            .entry_detail(entry_id)
    }

    pub(crate) fn lock(&mut self) -> Result<(), MobileError> {
        self.session.take().ok_or(MobileError::Locked)?;
        Ok(())
    }
}

impl Default for MobileVaultService {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::atomic::{AtomicU64, Ordering},
    };

    use vault_core::SecretString;

    use super::{MobileError, MobileVaultService};

    const FIXTURE_PASSWORD: &str = "demopass";
    static NEXT_DIRECTORY: AtomicU64 = AtomicU64::new(0);

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            let number = NEXT_DIRECTORY.fetch_add(1, Ordering::Relaxed);
            let path = std::env::temp_dir()
                .join(format!("nian-pass-mobile-{}-{number}", std::process::id()));
            fs::create_dir(&path).expect("test staging directory should be created");
            Self(path)
        }

        fn stage_fixture(&self, name: &str) -> PathBuf {
            let source = Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../fixtures/kdbx/keepassxc-2.7.12-kdbx41.kdbx");
            let staged = self.0.join(name);
            fs::copy(source, &staged).expect("fixture should be staged");
            staged
        }

        fn stage_bytes(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let staged = self.0.join(name);
            fs::write(&staged, bytes).expect("test bytes should be staged");
            staged
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn selection_dto_exposes_only_display_filename() {
        let directory = TestDirectory::new();
        let staged = directory.stage_bytes("opaque.kdbx", b"encrypted");
        let mut service = MobileVaultService::new();
        let dto = service
            .replace_selection(staged.clone(), "vault.kdbx".to_owned())
            .expect("selection should install");
        assert_eq!(dto.file_name, "vault.kdbx");
        assert!(staged.exists());
    }

    #[test]
    fn successful_replacement_deletes_the_previous_staging_file() {
        let directory = TestDirectory::new();
        let first = directory.stage_bytes("first.kdbx", b"first");
        let second = directory.stage_bytes("second.kdbx", b"second");
        let mut service = MobileVaultService::new();
        assert!(
            service
                .replace_selection(first.clone(), "first.kdbx".to_owned())
                .is_ok()
        );
        assert!(
            service
                .replace_selection(second.clone(), "second.kdbx".to_owned())
                .is_ok()
        );
        assert!(!first.exists());
        assert!(second.exists());
    }

    #[test]
    fn picker_cancel_policy_preserves_the_existing_pending_selection() {
        let directory = TestDirectory::new();
        let staged = directory.stage_bytes("pending.kdbx", b"pending");
        let mut service = MobileVaultService::new();
        assert!(
            service
                .replace_selection(staged.clone(), "pending.kdbx".to_owned())
                .is_ok()
        );
        // The command returns on native cancellation without mutating service.
        assert!(matches!(
            service.unlock(&SecretString::new("wrong".to_owned())),
            Err(MobileError::UnsupportedVault)
        ));
        assert!(staged.exists());
    }

    #[test]
    fn wrong_password_is_generic_and_retains_pending_for_retry() {
        let directory = TestDirectory::new();
        let staged = directory.stage_fixture("retry.kdbx");
        let mut service = MobileVaultService::new();
        assert!(
            service
                .replace_selection(staged.clone(), "retry.kdbx".to_owned())
                .is_ok()
        );
        assert!(matches!(
            service.unlock(&SecretString::new("wrong password".to_owned())),
            Err(MobileError::UnlockFailed)
        ));
        assert!(staged.exists());
        assert!(matches!(service.snapshot(), Err(MobileError::Locked)));
        assert!(
            service
                .unlock(&SecretString::new(FIXTURE_PASSWORD.to_owned()))
                .is_ok()
        );
    }

    #[test]
    fn successful_unlock_installs_candidate_and_removes_staging() {
        let directory = TestDirectory::new();
        let staged = directory.stage_fixture("success.kdbx");
        let mut service = MobileVaultService::new();
        assert!(
            service
                .replace_selection(staged.clone(), "success.kdbx".to_owned())
                .is_ok()
        );
        let snapshot = service
            .unlock(&SecretString::new(FIXTURE_PASSWORD.to_owned()))
            .expect("fixture should unlock");
        assert!(!staged.exists());
        assert!(!snapshot.groups.is_empty());
        let entry_id = snapshot
            .entries
            .first()
            .expect("fixture should contain an entry")
            .id
            .clone();
        assert!(service.entry_detail(&entry_id).is_ok());
        assert!(service.snapshot().is_ok());
    }

    #[test]
    fn malformed_candidate_does_not_install_a_session_or_destroy_pending() {
        let directory = TestDirectory::new();
        let staged = directory.stage_bytes("malformed.kdbx", b"not a KDBX document");
        let mut service = MobileVaultService::new();
        assert!(
            service
                .replace_selection(staged.clone(), "malformed.kdbx".to_owned())
                .is_ok()
        );
        assert!(matches!(
            service.unlock(&SecretString::new(FIXTURE_PASSWORD.to_owned())),
            Err(MobileError::UnsupportedVault)
        ));
        assert!(staged.exists());
        assert!(matches!(service.snapshot(), Err(MobileError::Locked)));
    }

    #[test]
    fn detail_requires_session_and_unknown_ids_are_generic() {
        let directory = TestDirectory::new();
        let staged = directory.stage_fixture("detail.kdbx");
        let mut service = MobileVaultService::new();
        assert!(matches!(
            service.entry_detail("missing"),
            Err(MobileError::Locked)
        ));
        assert!(
            service
                .replace_selection(staged, "detail.kdbx".to_owned())
                .is_ok()
        );
        assert!(
            service
                .unlock(&SecretString::new(FIXTURE_PASSWORD.to_owned()))
                .is_ok()
        );
        assert!(matches!(
            service.entry_detail("missing"),
            Err(MobileError::EntryNotFound)
        ));
    }

    #[test]
    fn lock_drops_the_read_session_immediately() {
        let directory = TestDirectory::new();
        let staged = directory.stage_fixture("lock.kdbx");
        let mut service = MobileVaultService::new();
        assert!(
            service
                .replace_selection(staged, "lock.kdbx".to_owned())
                .is_ok()
        );
        assert!(
            service
                .unlock(&SecretString::new(FIXTURE_PASSWORD.to_owned()))
                .is_ok()
        );
        assert!(service.lock().is_ok());
        assert!(matches!(service.snapshot(), Err(MobileError::Locked)));
        assert!(matches!(service.lock(), Err(MobileError::Locked)));
    }
}
