use std::path::PathBuf;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use vault_core::{EntryId, SecretBytes, SecretString};
use vault_session::{VaultSession, WriteRestriction};

mod attachments;
mod browser;
mod credential;
mod credential_flow;
mod custom_icons;
mod database_settings;
mod error;
mod export_copy;
mod generated_clipboard;
mod history;
mod keyfile_credential;
mod password_health;
mod snapshot;
mod sync_support;
mod totp;

use credential::DesktopVaultCredential;
pub use error::DesktopError;
pub(crate) use error::map_mutation_error;
use error::{map_clipboard_error, map_create_error, map_provider_error};

use crate::{
    clipboard::{ClipboardClearStatus, ClipboardCopy, ClipboardPort, DesktopClipboardService},
    dto::{ClosePolicyDto, EntryDetailDto, SelectedVaultDto, VaultSnapshotDto},
};

/// Rust-owned desktop state with at most one unlocked session.
pub struct DesktopVaultService {
    selected_path: Option<PathBuf>,
    session: Option<VaultSession>,
    save_credential: Option<DesktopVaultCredential>,
    pending_keyfile: Option<SecretBytes>,
    browser_session_id: Option<String>,
}

impl DesktopVaultService {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            selected_path: None,
            session: None,
            save_credential: None,
            pending_keyfile: None,
            browser_session_id: None,
        }
    }

    pub fn select_path(&mut self, path: PathBuf) -> Result<SelectedVaultDto, DesktopError> {
        if self.session.is_some() {
            return Err(DesktopError::AlreadyUnlocked);
        }

        let file_name = display_file_name(&path).ok_or(DesktopError::UnsupportedVault)?;
        self.selected_path = Some(path);
        self.pending_keyfile = None;
        Ok(SelectedVaultDto { file_name })
    }

    pub fn create(
        &mut self,
        path: PathBuf,
        vault_name: &str,
        credential: SecretString,
    ) -> Result<VaultSnapshotDto, DesktopError> {
        if self.session.is_some() {
            return Err(DesktopError::AlreadyUnlocked);
        }
        let session =
            VaultSession::create(&path, vault_name, &credential).map_err(map_create_error)?;
        let snapshot = snapshot::from_session(&session).map_err(map_create_error)?;
        let browser_session_id = random_process_token()?;
        self.selected_path = Some(session.path().to_owned());
        self.session = Some(session);
        self.save_credential = Some(DesktopVaultCredential::password(credential));
        self.pending_keyfile = None;
        self.browser_session_id = Some(browser_session_id);
        Ok(snapshot)
    }

    pub fn snapshot(&self) -> Result<VaultSnapshotDto, DesktopError> {
        let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
        snapshot::from_session(session).map_err(|_| DesktopError::Internal)
    }

    pub(crate) fn session_mut(&mut self) -> Result<&mut VaultSession, DesktopError> {
        self.require_writable()?;
        self.session.as_mut().ok_or(DesktopError::Locked)
    }

    fn require_writable(&self) -> Result<(), DesktopError> {
        let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
        session.write_restriction().map_or(Ok(()), |restriction| {
            Err(write_restriction_error(restriction))
        })
    }

    pub fn entry_detail(&self, entry_id: &str) -> Result<EntryDetailDto, DesktopError> {
        let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
        let id = EntryId::new(entry_id);
        let projection = session.projection().map_err(|_| DesktopError::Internal)?;
        let entry = projection
            .find_entry(&id)
            .ok_or(DesktopError::EntryNotFound)?;
        let custom_fields = session
            .document()
            .custom_fields(&id)
            .map_err(|_| DesktopError::Internal)?;
        Ok(EntryDetailDto::from_entry(entry, &custom_fields))
    }

    pub fn entry_password(&self, entry_id: &str) -> Result<SecretString, DesktopError> {
        let session = self.require_entry(entry_id)?;
        session
            .document()
            .entry_password(&EntryId::new(entry_id))
            .map_err(|_| DesktopError::Internal)?
            .ok_or(DesktopError::SecretUnavailable)
    }

    pub fn entry_title(&self, entry_id: &str) -> Result<SecretString, DesktopError> {
        let session = self.require_entry(entry_id)?;
        session
            .document()
            .entry_title(&EntryId::new(entry_id))
            .map_err(|_| DesktopError::Internal)?
            .ok_or(DesktopError::SecretUnavailable)
    }

    pub fn entry_url(&self, entry_id: &str) -> Result<SecretString, DesktopError> {
        let session = self.require_entry(entry_id)?;
        session
            .document()
            .entry_url(&EntryId::new(entry_id))
            .map_err(|_| DesktopError::Internal)?
            .ok_or(DesktopError::SecretUnavailable)
    }

    pub fn entry_custom_field(
        &self,
        entry_id: &str,
        name: &str,
    ) -> Result<SecretString, DesktopError> {
        let session = self.require_entry(entry_id)?;
        session
            .entry_custom_field(&EntryId::new(entry_id), name)
            .map_err(map_mutation_error)?
            .ok_or(DesktopError::SecretUnavailable)
    }

    pub fn entry_notes(&self, entry_id: &str) -> Result<SecretString, DesktopError> {
        let session = self.require_entry(entry_id)?;
        session
            .document()
            .entry_notes(&EntryId::new(entry_id))
            .map_err(|_| DesktopError::Internal)?
            .ok_or(DesktopError::SecretUnavailable)
    }

    pub fn entry_username(&self, entry_id: &str) -> Result<SecretString, DesktopError> {
        let session = self.require_entry(entry_id)?;
        session
            .document()
            .entry_username(&EntryId::new(entry_id))
            .map_err(|_| DesktopError::Internal)?
            .ok_or(DesktopError::SecretUnavailable)
    }

    pub fn lock(&mut self) -> Result<(), DesktopError> {
        if self
            .session
            .as_ref()
            .ok_or(DesktopError::Locked)?
            .is_dirty()
        {
            return Err(DesktopError::UnsavedChanges);
        }
        self.discard_and_lock()
    }

    pub fn discard_and_lock(&mut self) -> Result<(), DesktopError> {
        let session = self.session.take().ok_or(DesktopError::Locked)?;
        self.save_credential = None;
        self.pending_keyfile = None;
        self.browser_session_id = None;
        session.lock();
        self.selected_path = None;
        Ok(())
    }

    #[must_use]
    pub fn close_policy(&self) -> ClosePolicyDto {
        if self.session.as_ref().is_some_and(VaultSession::is_dirty) {
            ClosePolicyDto::ConfirmDiscard
        } else {
            ClosePolicyDto::Allow
        }
    }

    fn require_entry(&self, entry_id: &str) -> Result<&VaultSession, DesktopError> {
        let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
        let projection = session.projection().map_err(|_| DesktopError::Internal)?;
        if projection.find_entry(&EntryId::new(entry_id)).is_none() {
            return Err(DesktopError::EntryNotFound);
        }
        Ok(session)
    }
}

fn write_restriction_error(restriction: WriteRestriction) -> DesktopError {
    match restriction {
        WriteRestriction::UnsupportedWriteFormat => DesktopError::UnsupportedWriteFormat,
        WriteRestriction::UnsupportedPersistencePlatform => {
            DesktopError::UnsupportedPersistencePlatform
        }
        WriteRestriction::ReadOnlySource => DesktopError::ReadOnlySource,
    }
}

impl Default for DesktopVaultService {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone)]
pub struct AppState {
    pub service: Arc<Mutex<DesktopVaultService>>,
    pub clipboard: Arc<DesktopClipboardService>,
    secret_operation_gate: Arc<Mutex<()>>,
    vault_operation_active: Arc<AtomicBool>,
}

impl AppState {
    #[must_use]
    pub fn new(clipboard: Arc<dyn ClipboardPort>) -> Self {
        Self {
            service: Arc::new(Mutex::new(DesktopVaultService::new())),
            clipboard: Arc::new(DesktopClipboardService::new(clipboard)),
            secret_operation_gate: Arc::new(Mutex::new(())),
            vault_operation_active: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn begin_vault_operation(&self) -> Result<VaultOperationLease, DesktopError> {
        self.vault_operation_active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| DesktopError::OperationInProgress)?;
        Ok(VaultOperationLease {
            active: self.vault_operation_active.clone(),
        })
    }

    pub fn copy_entry_password(&self, entry_id: &str) -> Result<ClipboardCopy, DesktopError> {
        self.copy_entry_secret(entry_id, DesktopVaultService::entry_password)
    }

    pub fn copy_entry_title(&self, entry_id: &str) -> Result<ClipboardCopy, DesktopError> {
        self.copy_entry_secret(entry_id, DesktopVaultService::entry_title)
    }

    pub fn copy_entry_username(&self, entry_id: &str) -> Result<ClipboardCopy, DesktopError> {
        self.copy_entry_secret(entry_id, DesktopVaultService::entry_username)
    }

    pub fn copy_entry_url(&self, entry_id: &str) -> Result<ClipboardCopy, DesktopError> {
        self.copy_entry_secret(entry_id, DesktopVaultService::entry_url)
    }

    pub fn copy_entry_notes(&self, entry_id: &str) -> Result<ClipboardCopy, DesktopError> {
        self.copy_entry_secret(entry_id, DesktopVaultService::entry_notes)
    }

    pub fn copy_entry_custom_field(
        &self,
        entry_id: &str,
        name: &str,
    ) -> Result<ClipboardCopy, DesktopError> {
        self.copy_secret_with(|service| service.entry_custom_field(entry_id, name))
    }

    pub fn lock(&self) -> Result<ClipboardClearStatus, DesktopError> {
        self.lock_with(DesktopVaultService::lock)
    }

    pub fn discard_changes_and_lock(&self) -> Result<ClipboardClearStatus, DesktopError> {
        self.lock_with(DesktopVaultService::discard_and_lock)
    }

    pub fn browser_credential(
        &self,
        expected_session_id: &str,
        entry_id: &str,
        target: &credential_provider_core::CredentialTarget,
    ) -> Result<credential_provider_core::Credential, DesktopError> {
        let _operation = self
            .secret_operation_gate
            .lock()
            .map_err(|_| DesktopError::Internal)?;
        let service = self.service.lock().map_err(|_| DesktopError::Internal)?;
        service.browser_credential(expected_session_id, entry_id, target)
    }

    fn lock_with(
        &self,
        lock: fn(&mut DesktopVaultService) -> Result<(), DesktopError>,
    ) -> Result<ClipboardClearStatus, DesktopError> {
        let _vault_operation = self.begin_vault_operation()?;
        let _operation = self
            .secret_operation_gate
            .lock()
            .map_err(|_| DesktopError::Internal)?;
        {
            let mut service = self.service.lock().map_err(|_| DesktopError::Internal)?;
            lock(&mut service)?;
        }
        Ok(self.clipboard.clear_if_owned())
    }

    fn copy_entry_secret(
        &self,
        entry_id: &str,
        read: fn(&DesktopVaultService, &str) -> Result<SecretString, DesktopError>,
    ) -> Result<ClipboardCopy, DesktopError> {
        self.copy_secret_with(|service| read(service, entry_id))
    }

    fn copy_secret_with(
        &self,
        read: impl FnOnce(&DesktopVaultService) -> Result<SecretString, DesktopError>,
    ) -> Result<ClipboardCopy, DesktopError> {
        // Lock order is operation gate -> vault service. Clipboard state is
        // touched only after the vault-service guard has been released.
        let _operation = self
            .secret_operation_gate
            .lock()
            .map_err(|_| DesktopError::Internal)?;
        let secret = {
            let service = self.service.lock().map_err(|_| DesktopError::Internal)?;
            read(&service)?
        };
        self.clipboard.copy(&secret).map_err(map_clipboard_error)
    }
}

pub struct VaultOperationLease {
    active: Arc<AtomicBool>,
}

impl Drop for VaultOperationLease {
    fn drop(&mut self) {
        self.active.store(false, Ordering::Release);
    }
}

fn display_file_name(path: &std::path::Path) -> Option<String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
}

fn random_process_token() -> Result<String, DesktopError> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|_| DesktopError::Internal)?;
    let mut token = String::with_capacity(32);
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for byte in bytes {
        token.push(char::from(HEX[usize::from(byte >> 4)]));
        token.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    Ok(token)
}

#[cfg(test)]
mod tests {
    use std::{
        fs, io,
        path::{Path, PathBuf},
        sync::{
            Arc, Mutex, TryLockError,
            atomic::{AtomicBool, AtomicU64, Ordering},
            mpsc::{Receiver, SyncSender, TryRecvError, sync_channel},
        },
        thread,
        time::Duration,
    };

    use credential_provider_core::CredentialTarget;
    #[cfg(unix)]
    use kdbx::{KdbxCredential, KdbxDocument};
    use serde_json::{Map, Value, to_value};
    use vault_core::{EntryId, FieldProtection, NewEntry, SecretBytes, SecretString};
    use vault_session::{VaultSession, WriteRestriction};

    use vault_session::SessionError;

    use super::error::map_save_error;
    use super::{
        AppState, DesktopError, DesktopVaultCredential, DesktopVaultService,
        write_restriction_error,
    };
    use crate::{
        clipboard::{ClipboardClearStatus, ClipboardPort},
        dto::WriteRestrictionDto,
    };

    const FIXTURE_PASSWORD: &str = "demopass";
    const FIXTURE: &str = "keepassxc-2.7.12-kdbx41.kdbx";
    const TEST_COORDINATION_TIMEOUT: Duration = Duration::from_secs(3);
    static TEST_DIRECTORY_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    struct TestDir(PathBuf);

    impl TestDir {
        fn create() -> Self {
            let parent = std::env::temp_dir();
            for _ in 0..128 {
                let sequence = TEST_DIRECTORY_SEQUENCE.fetch_add(1, Ordering::Relaxed);
                let path = parent.join(format!(
                    "nian-pass-desktop-save-test-{}-{sequence}",
                    std::process::id()
                ));
                match fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
                    Err(error) => panic!("could not create desktop test directory: {error}"),
                }
            }
            panic!("could not allocate desktop test directory");
        }

        fn fixture_copy(&self) -> PathBuf {
            let path = self.0.join("vault.kdbx");
            fs::copy(fixture_path(), &path).expect("fixture copy should succeed");
            path
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn fixture_path() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fixtures/kdbx")
            .join(FIXTURE)
    }

    fn selected_service() -> DesktopVaultService {
        let mut service = DesktopVaultService::new();
        service
            .select_path(fixture_path())
            .expect("trusted fixture path should be selectable");
        service
    }

    fn unlock(service: &mut DesktopVaultService) {
        service
            .unlock(SecretString::new(FIXTURE_PASSWORD.to_owned()))
            .expect("trusted fixture should unlock");
    }

    fn isolated_service() -> (TestDir, PathBuf, DesktopVaultService) {
        let directory = TestDir::create();
        let path = directory.fixture_copy();
        let mut service = DesktopVaultService::new();
        service
            .select_path(path.clone())
            .expect("temporary fixture should be selectable");
        unlock(&mut service);
        (directory, path, service)
    }

    fn credential() -> SecretString {
        SecretString::new(FIXTURE_PASSWORD.to_owned())
    }

    fn mutate_first_title(service: &mut DesktopVaultService, title: &str) -> String {
        let entry_id = service
            .snapshot()
            .expect("snapshot should exist")
            .entries
            .first()
            .expect("fixture should contain an entry")
            .id
            .clone();
        service
            .session_mut()
            .expect("session should be unlocked")
            .document_mut()
            .set_entry_title(&EntryId::new(entry_id.clone()), title)
            .expect("title mutation should succeed");
        entry_id
    }

    fn write_external_version(path: &Path, title: &str) {
        let mut external = VaultSession::open(path, &credential()).expect("external source open");
        let entry = external
            .projection()
            .expect("external source projection")
            .root()
            .entries()
            .first()
            .expect("external source entry")
            .id()
            .clone();
        external
            .document_mut()
            .set_entry_title(&entry, title)
            .expect("external mutation should succeed");
        external
            .save(&credential())
            .expect("external save should succeed");
    }

    #[cfg(unix)]
    #[cfg(unix)]
    #[test]
    fn desktop_keyfile_unlock_retry_save_and_lock_keep_authority_in_rust() {
        const KEYFILE: &[u8] = b"public-desktop-keyfile-material";
        let directory = TestDir::create();
        let path = directory.0.join("keyfile-vault.kdbx");
        let document = KdbxDocument::new("Desktop keyfile");
        let mut file = fs::File::create(&path).expect("keyfile vault create");
        document
            .save_to_writer_with_credential(&mut file, KdbxCredential::new(None, Some(KEYFILE)))
            .expect("keyfile vault serialize");
        file.sync_all().expect("keyfile vault sync");

        let mut service = DesktopVaultService::new();
        service
            .select_path(path.clone())
            .expect("select keyfile vault");
        service
            .set_pending_keyfile(SecretBytes::new(KEYFILE.to_vec()))
            .expect("pending keyfile should be accepted");
        assert!(matches!(
            service.unlock_with_components(Some(SecretString::new(
                "wrong-public-password".to_owned()
            ))),
            Err(DesktopError::UnlockFailed)
        ));
        assert!(
            service.pending_keyfile.is_some(),
            "failed unlock must retain the selected keyfile for retry"
        );

        service
            .unlock_with_components(None)
            .expect("keyfile-only retry should unlock");
        assert!(service.pending_keyfile.is_none());
        let sync_authority = service
            .sync_credential(None)
            .expect("native keyfile sync authority");
        assert!(KdbxDocument::open_with_credential(&path, sync_authority.as_kdbx()).is_ok());
        assert!(
            service
                .save_credential
                .as_ref()
                .and_then(DesktopVaultCredential::keyfile)
                .is_some(),
            "unlocked session must retain keyfile authority in Rust"
        );

        let root = service
            .session
            .as_ref()
            .expect("session")
            .projection()
            .expect("projection")
            .root()
            .id()
            .clone();
        let created = service
            .session_mut()
            .expect("writable session")
            .create_group(&root, "Saved through retained keyfile")
            .expect("group mutation");
        service
            .save()
            .expect("ordinary Save should reuse retained keyfile");

        let reopened =
            KdbxDocument::open_with_credential(&path, KdbxCredential::new(None, Some(KEYFILE)))
                .expect("saved keyfile vault should reopen");
        assert!(
            reopened
                .projection()
                .expect("projection")
                .find_group(&created)
                .is_some()
        );

        service
            .reload_with_components(None)
            .expect("keyfile-only reload should reuse retained keyfile");
        assert!(
            service
                .snapshot()
                .expect("reloaded snapshot")
                .groups
                .iter()
                .any(|group| group.id == created.as_str())
        );

        service.lock().expect("clean keyfile session should lock");
        assert!(service.save_credential.is_none());
        assert!(service.pending_keyfile.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn master_password_rotation_preserves_keyfile_and_updates_retained_save_authority() {
        const KEYFILE: &[u8] = b"public-rotation-keyfile-material";
        let directory = TestDir::create();
        let path = directory.0.join("rotation-vault.kdbx");
        let document = KdbxDocument::new("Credential rotation");
        let mut file = fs::File::create(&path).expect("rotation vault create");
        document
            .save_to_writer_with_credential(
                &mut file,
                KdbxCredential::new(Some("old-public-password"), Some(KEYFILE)),
            )
            .expect("rotation vault serialize");
        file.sync_all().expect("rotation vault sync");

        let mut service = DesktopVaultService::new();
        service.select_path(path.clone()).expect("select vault");
        service
            .set_pending_keyfile(SecretBytes::new(KEYFILE.to_vec()))
            .expect("set keyfile");
        service
            .unlock_with_components(Some(SecretString::new("old-public-password".to_owned())))
            .expect("composite credential should unlock");

        let root_before_rotation = service
            .session
            .as_ref()
            .expect("session")
            .projection()
            .expect("projection")
            .root()
            .id()
            .clone();
        service
            .session_mut()
            .expect("session")
            .create_group(&root_before_rotation, "Unsaved before rotation")
            .expect("mutation should succeed");
        assert!(matches!(
            service.change_master_password(SecretString::new("blocked-input".to_owned())),
            Err(DesktopError::UnsavedChanges)
        ));
        service
            .save()
            .expect("explicit Save should clean the vault");

        let rotated = service
            .change_master_password(SecretString::new("new-public-password".to_owned()))
            .expect("credential rotation should succeed");
        assert!(!rotated.dirty);
        assert!(
            KdbxDocument::open_with_credential(
                &path,
                KdbxCredential::new(Some("new-public-password"), Some(KEYFILE)),
            )
            .is_ok()
        );
        assert!(
            KdbxDocument::open_with_credential(
                &path,
                KdbxCredential::new(Some("old-public-password"), Some(KEYFILE)),
            )
            .is_err()
        );

        let root = service
            .session
            .as_ref()
            .expect("session")
            .projection()
            .expect("projection")
            .root()
            .id()
            .clone();
        service
            .session_mut()
            .expect("session")
            .create_group(&root, "After rotation")
            .expect("mutation should succeed");
        service.save().expect("new retained authority should save");
        assert!(
            KdbxDocument::open_with_credential(
                &path,
                KdbxCredential::new(Some("new-public-password"), Some(KEYFILE)),
            )
            .is_ok()
        );
    }

    #[cfg(unix)]
    #[test]
    fn keyfile_rotation_add_replace_remove_preserves_retained_authority() {
        const PASSWORD: &str = "public-keyfile-rotation-password";
        const KEYFILE_A: &[u8] = b"public-keyfile-rotation-a";
        const KEYFILE_B: &[u8] = b"public-keyfile-rotation-b";
        let directory = TestDir::create();
        let path = directory.0.join("keyfile-rotation.kdbx");
        let document = KdbxDocument::new("Keyfile rotation");
        let mut file = fs::File::create(&path).expect("rotation vault create");
        document
            .save_to_writer_with_credential(&mut file, KdbxCredential::password(PASSWORD))
            .expect("rotation vault serialize");
        file.sync_all().expect("rotation vault sync");

        let mut service = DesktopVaultService::new();
        service.select_path(path.clone()).expect("select vault");
        service
            .unlock(SecretString::new(PASSWORD.to_owned()))
            .expect("password-only vault should unlock");
        assert!(!service.credential_has_keyfile().expect("credential status"));

        service
            .replace_keyfile(SecretBytes::new(KEYFILE_A.to_vec()))
            .expect("adding a keyfile should rotate the credential");
        assert!(service.credential_has_keyfile().expect("credential status"));
        assert!(
            KdbxDocument::open_with_credential(
                &path,
                KdbxCredential::new(Some(PASSWORD), Some(KEYFILE_A)),
            )
            .is_ok()
        );
        assert!(KdbxDocument::open(&path, PASSWORD).is_err());

        let root = service
            .session
            .as_ref()
            .expect("session")
            .projection()
            .expect("projection")
            .root()
            .id()
            .clone();
        service
            .session_mut()
            .expect("session")
            .create_group(&root, "Unsaved keyfile rotation")
            .expect("mutation");
        assert!(matches!(
            service.replace_keyfile(SecretBytes::new(KEYFILE_B.to_vec())),
            Err(DesktopError::UnsavedChanges)
        ));
        service.save().expect("save before replacing keyfile");

        service
            .replace_keyfile(SecretBytes::new(KEYFILE_B.to_vec()))
            .expect("replacing the keyfile should rotate the credential");
        assert!(
            KdbxDocument::open_with_credential(
                &path,
                KdbxCredential::new(Some(PASSWORD), Some(KEYFILE_A)),
            )
            .is_err()
        );
        assert!(
            KdbxDocument::open_with_credential(
                &path,
                KdbxCredential::new(Some(PASSWORD), Some(KEYFILE_B)),
            )
            .is_ok()
        );

        service
            .remove_keyfile()
            .expect("password component should permit keyfile removal");
        assert!(!service.credential_has_keyfile().expect("credential status"));
        assert!(KdbxDocument::open(&path, PASSWORD).is_ok());
        assert!(
            KdbxDocument::open_with_credential(
                &path,
                KdbxCredential::new(Some(PASSWORD), Some(KEYFILE_B)),
            )
            .is_err()
        );

        let root = service
            .session
            .as_ref()
            .expect("session")
            .projection()
            .expect("projection")
            .root()
            .id()
            .clone();
        service
            .session_mut()
            .expect("session")
            .create_group(&root, "Saved after keyfile removal")
            .expect("mutation");
        service.save().expect("retained password should save");
        assert!(KdbxDocument::open(&path, PASSWORD).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn keyfile_rotation_rejects_external_change_without_rewriting_vault() {
        let (_directory, path, mut service) = isolated_service();
        write_external_version(&path, "External wins over keyfile rotation");
        let primary = fs::read(&path).expect("external primary");
        let backup_path = path.with_extension("kdbx.bak");
        let backup = fs::read(&backup_path).expect("external backup");
        assert!(matches!(
            service.replace_keyfile(SecretBytes::new(b"public-new-keyfile".to_vec())),
            Err(DesktopError::ExternalChange)
        ));
        assert!(!service.credential_has_keyfile().expect("credential status"));
        assert_eq!(fs::read(&path).expect("primary"), primary);
        assert_eq!(fs::read(&backup_path).expect("backup"), backup);
        assert!(KdbxDocument::open(&path, FIXTURE_PASSWORD).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn keyfile_only_vault_refuses_to_remove_its_last_credential_component() {
        const KEYFILE: &[u8] = b"public-keyfile-only-removal";
        let directory = TestDir::create();
        let path = directory.0.join("keyfile-only-removal.kdbx");
        let document = KdbxDocument::new("Keyfile only removal");
        let mut file = fs::File::create(&path).expect("keyfile vault create");
        document
            .save_to_writer_with_credential(&mut file, KdbxCredential::new(None, Some(KEYFILE)))
            .expect("keyfile vault serialize");
        file.sync_all().expect("keyfile vault sync");

        let mut service = DesktopVaultService::new();
        service.select_path(path.clone()).expect("select vault");
        service
            .set_pending_keyfile(SecretBytes::new(KEYFILE.to_vec()))
            .expect("select keyfile");
        service
            .unlock_with_components(None)
            .expect("keyfile-only vault should unlock");

        assert!(matches!(
            service.remove_keyfile(),
            Err(DesktopError::InvalidRequest)
        ));
        assert!(service.credential_has_keyfile().expect("credential status"));
        assert!(
            KdbxDocument::open_with_credential(&path, KdbxCredential::new(None, Some(KEYFILE)))
                .is_ok()
        );
    }

    #[cfg(unix)]
    #[test]
    fn removing_master_password_keeps_keyfile_only_authority_for_save_and_readdition() {
        const KEYFILE: &[u8] = b"public-only-factor-after-removal";
        const NEW_PASSWORD: &str = "new-public-master-password";
        let (_directory, path, mut service) = isolated_service();
        assert!(service.credential_has_password().expect("password status"));
        assert!(matches!(
            service.remove_master_password(),
            Err(DesktopError::InvalidRequest)
        ));
        assert!(KdbxDocument::open(&path, FIXTURE_PASSWORD).is_ok());

        service
            .replace_keyfile(SecretBytes::new(KEYFILE.to_vec()))
            .expect("adding a keyfile should succeed");
        let clean = service
            .remove_master_password()
            .expect("remove master password");
        assert!(!clean.dirty);
        assert!(!service.credential_has_password().expect("password status"));
        assert!(service.credential_has_keyfile().expect("keyfile status"));
        assert!(KdbxDocument::open(&path, FIXTURE_PASSWORD).is_err());
        assert!(
            KdbxDocument::open_with_credential(
                &path,
                KdbxCredential::new(Some(FIXTURE_PASSWORD), Some(KEYFILE)),
            )
            .is_err()
        );
        assert!(
            KdbxDocument::open_with_credential(&path, KdbxCredential::new(None, Some(KEYFILE)))
                .is_ok()
        );
        assert!(matches!(
            service.remove_keyfile(),
            Err(DesktopError::InvalidRequest)
        ));
        assert!(matches!(
            service.remove_master_password(),
            Err(DesktopError::InvalidRequest)
        ));

        let entry_id = mutate_first_title(&mut service, "saved through keyfile only");
        service.save().expect("save under keyfile-only authority");
        let reopened =
            KdbxDocument::open_with_credential(&path, KdbxCredential::new(None, Some(KEYFILE)))
                .expect("keyfile-only save must reopen");
        assert!(
            reopened
                .projection()
                .expect("projection")
                .find_entry(&EntryId::new(entry_id))
                .is_some()
        );
        service
            .reload_with_components(None)
            .expect("keyfile-only reload must work");

        service
            .change_master_password(SecretString::new(NEW_PASSWORD.to_owned()))
            .expect("re-add master password");
        assert!(
            service
                .credential_has_password()
                .expect("password restored")
        );
        assert!(
            KdbxDocument::open_with_credential(
                &path,
                KdbxCredential::new(Some(NEW_PASSWORD), Some(KEYFILE)),
            )
            .is_ok()
        );
        assert!(
            KdbxDocument::open_with_credential(&path, KdbxCredential::new(None, Some(KEYFILE)))
                .is_err()
        );
        service
            .remove_keyfile()
            .expect("new password is sufficient");
        assert!(KdbxDocument::open(&path, NEW_PASSWORD).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn master_password_removal_rejects_dirty_and_external_generations_without_writing() {
        const KEYFILE: &[u8] = b"public-removal-external-keyfile";
        let (_directory, path, mut service) = isolated_service();
        service
            .replace_keyfile(SecretBytes::new(KEYFILE.to_vec()))
            .expect("add keyfile");
        mutate_first_title(&mut service, "unsaved before password removal");
        assert!(matches!(
            service.remove_master_password(),
            Err(DesktopError::UnsavedChanges)
        ));
        service.save().expect("save local changes");
        let mut external = VaultSession::open_with_credential(
            &path,
            KdbxCredential::new(Some(FIXTURE_PASSWORD), Some(KEYFILE)),
        )
        .expect("open external composite credential");
        let first = external.projection().expect("projection").root().entries()[0]
            .id()
            .clone();
        external
            .document_mut()
            .set_entry_title(&first, "new external generation")
            .expect("external edit");
        external
            .save_with_credential(KdbxCredential::new(Some(FIXTURE_PASSWORD), Some(KEYFILE)))
            .expect("external save");
        let primary = fs::read(&path).expect("primary");
        let backup_path = path.with_extension("kdbx.bak");
        let backup = fs::read(&backup_path).expect("backup");
        assert!(matches!(
            service.remove_master_password(),
            Err(DesktopError::ExternalChange)
        ));
        assert_eq!(fs::read(&path).expect("primary intact"), primary);
        assert_eq!(fs::read(&backup_path).expect("backup intact"), backup);
        assert!(
            service
                .credential_has_password()
                .expect("password retained")
        );
        assert!(
            KdbxDocument::open_with_credential(
                &path,
                KdbxCredential::new(Some(FIXTURE_PASSWORD), Some(KEYFILE)),
            )
            .is_ok()
        );
    }

    #[cfg(unix)]
    #[test]
    fn uncertain_master_removal_reconciles_only_the_installed_keyfile_authority() {
        const KEYFILE: &[u8] = b"public-master-removal-reconcile";
        let (_directory, path, mut service) = isolated_service();
        service
            .replace_keyfile(SecretBytes::new(KEYFILE.to_vec()))
            .expect("add keyfile");
        service
            .reconcile_rotation_authority(None)
            .expect("no installation yet");
        assert!(
            service
                .credential_has_password()
                .expect("old authority unchanged")
        );
        let mut external = VaultSession::open_with_credential(
            &path,
            KdbxCredential::new(Some(FIXTURE_PASSWORD), Some(KEYFILE)),
        )
        .expect("external composite credential");
        external
            .rotate_credential(
                KdbxCredential::new(Some(FIXTURE_PASSWORD), Some(KEYFILE)),
                KdbxCredential::new(None, Some(KEYFILE)),
            )
            .expect("install keyfile-only credential");
        service
            .reconcile_rotation_authority(None)
            .expect("reconcile installed authority");
        assert!(
            !service
                .credential_has_password()
                .expect("password no longer retained")
        );
        assert!(
            KdbxDocument::open_with_credential(&path, KdbxCredential::new(None, Some(KEYFILE)))
                .is_ok()
        );
        mutate_first_title(&mut service, "save after uncertain removal reconciliation");
        service.save().expect("retained authority supports save");
        assert!(
            KdbxDocument::open_with_credential(&path, KdbxCredential::new(None, Some(KEYFILE)))
                .is_ok()
        );
    }

    #[cfg(unix)]
    #[test]
    fn empty_password_is_not_a_remaining_factor_for_keyfile_removal() {
        const KEYFILE: &[u8] = b"public-empty-password-keyfile";
        let directory = TestDir::create();
        let path = directory.0.join("empty-password-keyfile.kdbx");
        let mut file = fs::File::create(&path).expect("create file");
        KdbxDocument::new("Empty password composite")
            .save_to_writer_with_credential(&mut file, KdbxCredential::new(Some(""), Some(KEYFILE)))
            .expect("serialize composite");
        file.sync_all().expect("sync composite");
        let mut service = DesktopVaultService::new();
        service.select_path(path.clone()).expect("select vault");
        service
            .set_pending_keyfile(SecretBytes::new(KEYFILE.to_vec()))
            .expect("select keyfile");
        service
            .unlock_with_components(Some(SecretString::new(String::new())))
            .expect("explicit empty password differs from missing password");
        let original = fs::read(&path).expect("original generation");
        assert!(matches!(
            service.remove_keyfile(),
            Err(DesktopError::InvalidRequest)
        ));
        assert_eq!(fs::read(&path).expect("unchanged generation"), original);
        assert!(
            KdbxDocument::open_with_credential(&path, KdbxCredential::new(Some(""), Some(KEYFILE)))
                .is_ok()
        );
    }

    #[cfg(unix)]
    #[test]
    fn keyfile_reconciliation_adopts_only_the_credential_proven_on_disk() {
        const PASSWORD: &str = "public-reconcile-password";
        const KEYFILE: &[u8] = b"public-reconcile-keyfile";
        let directory = TestDir::create();
        let path = directory.0.join("keyfile-reconcile.kdbx");
        let document = KdbxDocument::new("Keyfile reconciliation");
        let mut file = fs::File::create(&path).expect("vault create");
        document
            .save_to_writer_with_credential(&mut file, KdbxCredential::password(PASSWORD))
            .expect("vault serialize");
        file.sync_all().expect("vault sync");

        let mut service = DesktopVaultService::new();
        service.select_path(path.clone()).expect("select vault");
        service
            .unlock(SecretString::new(PASSWORD.to_owned()))
            .expect("password-only unlock");

        service
            .reconcile_keyfile_authority(Some(SecretBytes::new(KEYFILE.to_vec())))
            .expect("uninstalled keyfile must leave current authority intact");
        assert!(!service.credential_has_keyfile().expect("credential status"));
        assert!(KdbxDocument::open(&path, PASSWORD).is_ok());

        let mut external = VaultSession::open(&path, &SecretString::new(PASSWORD.to_owned()))
            .expect("external session open");
        external
            .rotate_credential(
                KdbxCredential::password(PASSWORD),
                KdbxCredential::new(Some(PASSWORD), Some(KEYFILE)),
            )
            .expect("external keyfile addition");

        service
            .reconcile_keyfile_authority(Some(SecretBytes::new(KEYFILE.to_vec())))
            .expect("installed keyfile should become retained authority");
        assert!(service.credential_has_keyfile().expect("credential status"));
        assert!(
            KdbxDocument::open_with_credential(
                &path,
                service
                    .save_credential
                    .as_ref()
                    .expect("retained credential")
                    .as_kdbx(),
            )
            .is_ok()
        );
        assert!(KdbxDocument::open(&path, PASSWORD).is_err());

        service
            .reconcile_keyfile_authority(None)
            .expect("uninstalled removal must leave composite authority intact");
        assert!(service.credential_has_keyfile().expect("credential status"));

        let mut external = VaultSession::open_with_credential(
            &path,
            KdbxCredential::new(Some(PASSWORD), Some(KEYFILE)),
        )
        .expect("external composite session open");
        external
            .rotate_credential(
                KdbxCredential::new(Some(PASSWORD), Some(KEYFILE)),
                KdbxCredential::password(PASSWORD),
            )
            .expect("external keyfile removal");

        service
            .reconcile_keyfile_authority(None)
            .expect("installed removal should become retained authority");
        assert!(!service.credential_has_keyfile().expect("credential status"));
        assert!(KdbxDocument::open(&path, PASSWORD).is_ok());
        assert!(
            KdbxDocument::open_with_credential(
                &path,
                KdbxCredential::new(Some(PASSWORD), Some(KEYFILE)),
            )
            .is_err()
        );

        let root = service
            .session
            .as_ref()
            .expect("reconciled session")
            .projection()
            .expect("projection")
            .root()
            .id()
            .clone();
        service
            .session_mut()
            .expect("reconciled session")
            .create_group(&root, "Saved with reconciled password authority")
            .expect("post-reconciliation mutation");
        service.save().expect("reconciled authority should Save");
        assert!(KdbxDocument::open(&path, PASSWORD).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn uncertain_rotation_reconciliation_adopts_replacement_authority_only_when_canonical() {
        let directory = TestDir::create();
        let path = directory.0.join("rotation-reconcile.kdbx");
        let document = KdbxDocument::new("Rotation reconciliation");
        let mut file = fs::File::create(&path).expect("rotation vault create");
        document
            .save_to_writer_with_credential(&mut file, KdbxCredential::password("alpha"))
            .expect("rotation vault serialize");
        file.sync_all().expect("rotation vault sync");

        let mut service = DesktopVaultService::new();
        service.select_path(path.clone()).expect("select vault");
        service
            .unlock(SecretString::new("alpha".to_owned()))
            .expect("source should unlock");

        service
            .reconcile_rotation_authority(Some(SecretString::new("beta".to_owned())))
            .expect("unchanged source should keep current authority");
        let retained = service
            .save_credential
            .as_ref()
            .expect("retained credential");
        assert!(KdbxDocument::open_with_credential(&path, retained.as_kdbx()).is_ok());
        assert!(KdbxDocument::open(&path, "beta").is_err());

        let mut external = VaultSession::open(&path, &SecretString::new("alpha".to_owned()))
            .expect("external session should open");
        external
            .rotate_credential(
                KdbxCredential::password("alpha"),
                KdbxCredential::password("beta"),
            )
            .expect("external rotation should install replacement authority");

        service
            .reconcile_rotation_authority(Some(SecretString::new("beta".to_owned())))
            .expect("reconciliation should preserve a usable authority");
        let retained = service
            .save_credential
            .as_ref()
            .expect("retained credential");
        assert!(KdbxDocument::open_with_credential(&path, retained.as_kdbx()).is_ok());
        assert!(KdbxDocument::open(&path, "alpha").is_err());

        let root = service
            .session
            .as_ref()
            .expect("reconciled session")
            .projection()
            .expect("projection")
            .root()
            .id()
            .clone();
        service
            .session_mut()
            .expect("reconciled session")
            .create_group(&root, "After uncertain rotation")
            .expect("mutation should succeed");
        service.save().expect("reconciled baseline should save");
        assert!(KdbxDocument::open(&path, "beta").is_ok());
    }

    #[test]
    fn create_new_vault_is_clean_writable_persistable_and_drops_session_credential_on_lock() {
        let directory = TestDir::create();
        let path = directory.0.join("created.kdbx");
        let mut service = DesktopVaultService::new();
        let snapshot = service
            .create(path.clone(), "Personal", credential())
            .expect("new vault should be created");
        assert!(!snapshot.dirty);
        assert_eq!(snapshot.file_name, "created.kdbx");
        assert_eq!(snapshot.capabilities.format_version, "4.1");
        assert!(snapshot.capabilities.writable);
        assert!(snapshot.capabilities.write_restriction.is_none());
        assert!(service.save_credential.is_some());

        let root = snapshot.root_group_id.clone();
        service
            .session_mut()
            .expect("created vault should be writable")
            .document_mut()
            .create_group(&vault_core::GroupId::new(root), "Accounts")
            .expect("group creation should mutate the new vault");
        assert!(service.snapshot().expect("dirty snapshot").dirty);
        assert!(
            !service
                .save()
                .expect("retained credential should save")
                .dirty
        );
        VaultSession::open(&path, &credential()).expect("created vault should reopen");

        let mut duplicate = DesktopVaultService::new();
        assert!(matches!(
            duplicate.create(path, "Duplicate", credential()),
            Err(DesktopError::VaultAlreadyExists)
        ));
        service
            .discard_and_lock()
            .expect("clean created vault should lock");
        assert!(service.save_credential.is_none());
    }

    #[cfg(unix)]
    #[test]
    fn unsupported_kdbx_version_is_read_only_before_mutation() {
        let directory = TestDir::create();
        let path = directory.0.join("legacy.kdbx");
        fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../fixtures/kdbx/keepass-upstream-kdbx31-aeskdf-aes.kdbx"),
            &path,
        )
        .expect("legacy fixture copy should succeed");
        let mut service = DesktopVaultService::new();
        service
            .select_path(path)
            .expect("legacy fixture should be selectable");
        let snapshot = service
            .unlock(credential())
            .expect("legacy fixture should open read-only");
        assert!(!snapshot.capabilities.writable);
        assert_eq!(snapshot.capabilities.format_version, "3.1");
        assert!(matches!(
            snapshot.capabilities.write_restriction,
            Some(WriteRestrictionDto::UnsupportedWriteFormat)
        ));
        assert!(matches!(
            service.session_mut(),
            Err(DesktopError::UnsupportedWriteFormat)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn readonly_source_is_reported_before_mutation() {
        let directory = TestDir::create();
        let path = directory.fixture_copy();
        let mut permissions = fs::metadata(&path).expect("fixture metadata").permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&path, permissions).expect("fixture should become read-only");

        let mut service = DesktopVaultService::new();
        service
            .select_path(path)
            .expect("read-only fixture should be selectable");
        let snapshot = service
            .unlock(credential())
            .expect("read-only fixture should unlock");
        assert!(!snapshot.capabilities.writable);
        assert!(matches!(
            snapshot.capabilities.write_restriction,
            Some(WriteRestrictionDto::ReadOnlySource)
        ));
        assert!(matches!(
            service.session_mut(),
            Err(DesktopError::ReadOnlySource)
        ));
    }

    #[test]
    fn write_restriction_errors_are_stable_for_every_reason() {
        assert_eq!(
            write_restriction_error(WriteRestriction::UnsupportedWriteFormat),
            DesktopError::UnsupportedWriteFormat
        );
        assert_eq!(
            write_restriction_error(WriteRestriction::UnsupportedPersistencePlatform),
            DesktopError::UnsupportedPersistencePlatform
        );
        assert_eq!(
            write_restriction_error(WriteRestriction::ReadOnlySource),
            DesktopError::ReadOnlySource
        );
    }

    #[derive(Default)]
    struct TestClipboard {
        content: Mutex<Option<String>>,
        fail_clear: Mutex<bool>,
    }

    impl ClipboardPort for TestClipboard {
        fn write_text(&self, value: &str) -> Result<(), ()> {
            *self.content.lock().map_err(|_| ())? = Some(value.to_owned());
            Ok(())
        }

        fn read_text(&self) -> Result<Option<String>, ()> {
            self.content
                .lock()
                .map_err(|_| ())
                .map(|value| value.clone())
        }

        fn clear(&self) -> Result<(), ()> {
            if *self.fail_clear.lock().map_err(|_| ())? {
                return Err(());
            }
            *self.content.lock().map_err(|_| ())? = None;
            Ok(())
        }
    }

    struct BlockingWriteClipboard {
        content: Mutex<Option<String>>,
        write_started: SyncSender<()>,
        allow_write: Mutex<Receiver<()>>,
    }

    impl ClipboardPort for BlockingWriteClipboard {
        fn write_text(&self, value: &str) -> Result<(), ()> {
            self.write_started.send(()).map_err(|_| ())?;
            self.allow_write
                .lock()
                .map_err(|_| ())?
                .recv_timeout(TEST_COORDINATION_TIMEOUT)
                .map_err(|_| ())?;
            *self.content.lock().map_err(|_| ())? = Some(value.to_owned());
            Ok(())
        }

        fn read_text(&self) -> Result<Option<String>, ()> {
            self.content
                .lock()
                .map_err(|_| ())
                .map(|value| value.clone())
        }

        fn clear(&self) -> Result<(), ()> {
            *self.content.lock().map_err(|_| ())? = None;
            Ok(())
        }
    }

    struct BlockingReadClipboard {
        content: Mutex<Option<String>>,
        block_read: AtomicBool,
        read_started: SyncSender<()>,
        allow_read: Mutex<Receiver<()>>,
    }

    impl ClipboardPort for BlockingReadClipboard {
        fn write_text(&self, value: &str) -> Result<(), ()> {
            *self.content.lock().map_err(|_| ())? = Some(value.to_owned());
            Ok(())
        }

        fn read_text(&self) -> Result<Option<String>, ()> {
            if self.block_read.load(Ordering::SeqCst) {
                self.read_started.send(()).map_err(|_| ())?;
                self.allow_read
                    .lock()
                    .map_err(|_| ())?
                    .recv_timeout(TEST_COORDINATION_TIMEOUT)
                    .map_err(|_| ())?;
            }
            self.content
                .lock()
                .map_err(|_| ())
                .map(|value| value.clone())
        }

        fn clear(&self) -> Result<(), ()> {
            *self.content.lock().map_err(|_| ())? = None;
            Ok(())
        }
    }

    fn unlocked_state(clipboard: Arc<dyn ClipboardPort>) -> (AppState, String) {
        let state = AppState::new(clipboard);
        let entry_id = {
            let mut service = state.service.lock().expect("desktop service lock");
            service
                .select_path(fixture_path())
                .expect("trusted fixture path should be selectable");
            let snapshot = service
                .unlock(SecretString::new(FIXTURE_PASSWORD.to_owned()))
                .expect("trusted fixture should unlock");
            snapshot
                .entries
                .iter()
                .find(|entry| {
                    entry.password_present
                        && !matches!(entry.username, crate::dto::SummaryTextDto::Missing)
                })
                .expect("fixture should contain a username and password")
                .id
                .clone()
        };
        (state, entry_id)
    }

    fn unlocked_app() -> (AppState, Arc<TestClipboard>, String) {
        let clipboard = Arc::new(TestClipboard::default());
        let (state, entry_id) = unlocked_state(clipboard.clone());
        (state, clipboard, entry_id)
    }

    #[test]
    fn correct_password_unlocks_and_exposes_snapshot() {
        let mut service = selected_service();
        unlock(&mut service);
        let snapshot = service.snapshot().expect("unlocked snapshot should exist");
        assert!(!snapshot.groups.is_empty());
        assert!(!snapshot.entries.is_empty());
    }

    #[test]
    fn browser_vault_session_identity_changes_on_reload_lock_and_new_unlock() {
        let mut service = selected_service();
        unlock(&mut service);
        let first = service
            .browser_session_id
            .clone()
            .unwrap_or_else(|| panic!("unlock must create browser session identity"));
        assert_eq!(first.len(), 32);

        service
            .reload(SecretString::new(FIXTURE_PASSWORD.to_owned()))
            .unwrap_or_else(|error| panic!("reload must succeed: {error:?}"));
        let second = service
            .browser_session_id
            .clone()
            .unwrap_or_else(|| panic!("reload must replace browser session identity"));
        assert_ne!(second, first);

        service
            .lock()
            .unwrap_or_else(|error| panic!("lock must succeed: {error:?}"));
        assert!(service.browser_session_id.is_none());
        let target = CredentialTarget::browser_origin("https://example.com")
            .unwrap_or_else(|_| panic!("test origin must be valid"));
        assert!(matches!(
            service.browser_credential(&second, "stale-entry", &target),
            Err(DesktopError::Locked)
        ));

        service
            .select_path(fixture_path())
            .unwrap_or_else(|error| panic!("fixture must be selectable: {error:?}"));
        unlock(&mut service);
        let third = service
            .browser_session_id
            .clone()
            .unwrap_or_else(|| panic!("new unlock must create identity"));
        assert_ne!(third, second);
        assert!(matches!(
            service.browser_credential(&second, "stale-entry", &target),
            Err(DesktopError::SecretUnavailable)
        ));
    }

    #[test]
    fn browser_final_read_revalidates_session_entry_and_exact_origin() {
        let mut service = selected_service();
        unlock(&mut service);
        let target = CredentialTarget::browser_origin("https://login.example.test")
            .unwrap_or_else(|_| panic!("test origin must be valid"));
        let session_id = service
            .browser_session_id
            .clone()
            .unwrap_or_else(|| panic!("session identity missing"));
        let entry_id = {
            let session = service
                .session
                .as_mut()
                .unwrap_or_else(|| panic!("session must be unlocked"));
            let root_id = session
                .projection()
                .unwrap_or_else(|error| panic!("fixture must project: {error}"))
                .root()
                .id()
                .clone();
            session
                .document_mut()
                .create_entry(
                    &root_id,
                    NewEntry {
                        title: "Browser synthetic",
                        username: "browser-user",
                        url: "https://login.example.test/account",
                        password: Some(&SecretString::new("browser-password".to_owned())),
                    },
                )
                .unwrap_or_else(|error| panic!("entry must be created: {error}"))
        };
        let listed = service
            .browser_candidates(&target)
            .unwrap_or_else(|error| panic!("candidates must succeed: {error:?}"));
        assert!(
            listed
                .1
                .iter()
                .any(|candidate| candidate.entry_id() == entry_id.as_str())
        );
        let credential = service
            .browser_credential(&session_id, entry_id.as_str(), &target)
            .unwrap_or_else(|error| panic!("final read must succeed: {error:?}"));
        assert_eq!(credential.password().expose_secret(), "browser-password");
        assert!(matches!(
            service.browser_credential(&"f".repeat(32), entry_id.as_str(), &target),
            Err(DesktopError::SecretUnavailable)
        ));
        assert!(matches!(
            service.browser_credential(&session_id, "missing-entry", &target),
            Err(DesktopError::SecretUnavailable)
        ));

        service
            .session
            .as_mut()
            .unwrap_or_else(|| panic!("session must remain unlocked"))
            .document_mut()
            .set_entry_url(&entry_id, "https://changed.example.test")
            .unwrap_or_else(|error| panic!("URL mutation must succeed: {error}"));
        assert!(matches!(
            service.browser_credential(&session_id, entry_id.as_str(), &target),
            Err(DesktopError::SecretUnavailable)
        ));
        service
            .session
            .as_mut()
            .unwrap_or_else(|| panic!("session must remain unlocked"))
            .document_mut()
            .permanently_delete_entry(&entry_id)
            .unwrap_or_else(|error| panic!("entry deletion must succeed: {error}"));
        assert!(matches!(
            service.browser_credential(&session_id, entry_id.as_str(), &target),
            Err(DesktopError::SecretUnavailable)
        ));
    }

    #[test]
    fn app_state_browser_read_uses_the_shared_secret_operation_gate() {
        let state = AppState::new(Arc::new(TestClipboard::default()));
        let target = CredentialTarget::browser_origin("https://login.example.test")
            .unwrap_or_else(|_| panic!("test origin must be valid"));
        let (session_id, entry_id) = {
            let mut service = state
                .service
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            *service = selected_service();
            unlock(&mut service);
            let session_id = service
                .browser_session_id
                .clone()
                .unwrap_or_else(|| panic!("browser session identity missing"));
            let session = service
                .session
                .as_mut()
                .unwrap_or_else(|| panic!("session must be unlocked"));
            let root_id = session
                .projection()
                .unwrap_or_else(|error| panic!("fixture must project: {error}"))
                .root()
                .id()
                .clone();
            let entry_id = session
                .document_mut()
                .create_entry(
                    &root_id,
                    NewEntry {
                        title: "Browser gate",
                        username: "gate-user",
                        url: "https://login.example.test/account",
                        password: Some(&SecretString::new("gate-password".to_owned())),
                    },
                )
                .unwrap_or_else(|error| panic!("entry must be created: {error}"));
            (session_id, entry_id)
        };
        let credential = state
            .browser_credential(&session_id, entry_id.as_str(), &target)
            .unwrap_or_else(|error| panic!("gated browser read must succeed: {error:?}"));
        assert_eq!(credential.password().expose_secret(), "gate-password");
    }

    #[test]
    fn save_errors_map_to_minimal_stable_desktop_categories() {
        assert_eq!(
            map_save_error(SessionError::ExternalModificationDetected),
            DesktopError::ExternalChange
        );
        assert_eq!(
            map_save_error(SessionError::FinalExternalModificationDetected),
            DesktopError::ExternalChange
        );
        assert_eq!(
            map_save_error(SessionError::CredentialMismatch),
            DesktopError::SaveAuthenticationFailed
        );
        assert_eq!(
            map_save_error(SessionError::FinalReadFailed(io::Error::other(
                "synthetic final read failure"
            ))),
            DesktopError::SaveUncertain
        );
        let final_verification_error = match VaultSession::open(
            fixture_path(),
            &SecretString::new("synthetic-wrong-password".to_owned()),
        ) {
            Err(SessionError::Kdbx(error)) => error,
            _ => panic!("wrong fixture credential should produce a KDBX error"),
        };
        assert_eq!(
            map_save_error(SessionError::FinalVerificationFailed(
                final_verification_error
            )),
            DesktopError::SaveUncertain
        );
        assert_eq!(
            map_save_error(SessionError::SavedButBackupUpdateFailed(io::Error::other(
                "synthetic backup update failure"
            ))),
            DesktopError::SaveUncertain
        );
        assert_eq!(
            map_save_error(SessionError::SavedButBackupDurabilityUncertain(
                io::Error::other("synthetic backup durability uncertainty")
            )),
            DesktopError::SaveUncertain
        );
        assert_eq!(
            map_save_error(SessionError::DurabilityUncertain(io::Error::other(
                "synthetic post-commit uncertainty"
            ))),
            DesktopError::SaveUncertain
        );
        assert_eq!(
            map_save_error(SessionError::AtomicReplaceFailed(io::Error::other(
                "synthetic pre-commit replacement failure"
            ))),
            DesktopError::SaveFailed
        );
    }

    #[test]
    fn wrong_password_leaves_service_locked_and_allows_retry() {
        let mut service = selected_service();
        let result = service.unlock(SecretString::new("wrong-password".to_owned()));
        assert!(matches!(result, Err(DesktopError::UnlockFailed)));
        assert!(matches!(service.snapshot(), Err(DesktopError::Locked)));

        unlock(&mut service);
        assert!(service.snapshot().is_ok());
    }

    #[test]
    fn unsupported_file_maps_to_stable_public_error() {
        let mut service = DesktopVaultService::new();
        let unsupported = Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml");
        service
            .select_path(unsupported)
            .expect("ordinary file path should be selectable before validation");

        let result = service.unlock(SecretString::new(FIXTURE_PASSWORD.to_owned()));
        assert!(matches!(result, Err(DesktopError::UnsupportedVault)));
        assert!(matches!(service.snapshot(), Err(DesktopError::Locked)));
    }

    #[test]
    fn lock_drops_session_and_snapshot_becomes_locked() {
        let mut service = selected_service();
        unlock(&mut service);
        service.lock().expect("unlocked service should lock");
        assert!(matches!(service.snapshot(), Err(DesktopError::Locked)));
    }

    #[test]
    fn duplicate_unlock_is_rejected_without_replacing_session() {
        let mut service = selected_service();
        unlock(&mut service);
        let before = to_value(service.snapshot().expect("snapshot should exist"))
            .expect("snapshot should serialize");

        let result = service.unlock(SecretString::new(FIXTURE_PASSWORD.to_owned()));
        assert!(matches!(result, Err(DesktopError::AlreadyUnlocked)));
        let after = to_value(service.snapshot().expect("original session should remain"))
            .expect("snapshot should serialize");
        assert_eq!(before, after);
    }

    #[cfg(unix)]
    #[test]
    fn save_uses_session_transaction_clears_dirty_and_updates_baseline() {
        let (_directory, path, mut service) = isolated_service();
        let initial = fs::read(&path).expect("initial source should be readable");
        let entry_id = mutate_first_title(&mut service, "desktop saved B");
        assert!(service.snapshot().expect("dirty snapshot").dirty);

        let saved = service.save().expect("desktop save should succeed");
        assert!(!saved.dirty);
        assert!(fs::read(&path).expect("saved source should be readable") != initial);
        let reopened =
            VaultSession::open(&path, &credential()).expect("saved source should reopen");
        assert_eq!(
            reopened
                .document()
                .entry_title(&EntryId::new(entry_id.clone()))
                .expect("saved title read")
                .expect("saved title present")
                .expose_secret(),
            "desktop saved B"
        );

        mutate_first_title(&mut service, "desktop saved C");
        assert!(!service.save().expect("second save should succeed").dirty);
        let reopened = VaultSession::open(&path, &credential()).expect("second save should reopen");
        assert_eq!(
            reopened
                .document()
                .entry_title(&EntryId::new(entry_id))
                .expect("second saved title read")
                .expect("second saved title present")
                .expose_secret(),
            "desktop saved C"
        );
    }

    #[cfg(unix)]
    #[test]
    fn failed_save_keeps_source_and_dirty_session_available_for_retry() {
        let (_directory, path, mut service) = isolated_service();
        let before = fs::read(&path).expect("source should be readable");
        let entry_id = mutate_first_title(&mut service, "local retry edit");

        service.save_credential = Some(DesktopVaultCredential::password(SecretString::new(
            "wrong-password".to_owned(),
        )));
        assert!(matches!(
            service.save(),
            Err(DesktopError::SaveAuthenticationFailed)
        ));
        assert_eq!(fs::read(&path).expect("source should remain"), before);
        assert!(service.snapshot().expect("session should remain").dirty);
        assert_eq!(
            service
                .entry_title(&entry_id)
                .expect("local mutation should remain")
                .expose_secret(),
            "local retry edit"
        );
        service.save_credential = Some(DesktopVaultCredential::password(credential()));
        assert!(!service.save().expect("valid retry should succeed").dirty);
    }

    #[cfg(unix)]
    #[test]
    fn external_change_and_deletion_are_fail_closed_without_losing_local_edits() {
        let (_directory, path, mut service) = isolated_service();
        let entry_id = mutate_first_title(&mut service, "local B");
        write_external_version(&path, "external C");
        let external = fs::read(&path).expect("external source should be readable");

        assert!(matches!(service.save(), Err(DesktopError::ExternalChange)));
        assert_eq!(
            fs::read(&path).expect("external source should remain"),
            external
        );
        assert!(
            service
                .snapshot()
                .expect("local session should remain")
                .dirty
        );
        assert_eq!(
            service
                .entry_title(&entry_id)
                .expect("local title should remain")
                .expose_secret(),
            "local B"
        );

        fs::remove_file(&path).expect("external deletion should succeed");
        assert!(matches!(service.save(), Err(DesktopError::ExternalChange)));
        assert!(!path.exists());
        assert!(
            service
                .snapshot()
                .expect("deleted-source session should remain")
                .dirty
        );
    }

    #[cfg(unix)]
    #[test]
    fn external_change_after_a_successful_save_uses_the_fresh_baseline() {
        let (_directory, path, mut service) = isolated_service();
        mutate_first_title(&mut service, "saved S1");
        service.save().expect("first save should succeed");
        write_external_version(&path, "external after S1");
        let external = fs::read(&path).expect("external generation should be readable");
        mutate_first_title(&mut service, "local after S1");

        assert!(matches!(service.save(), Err(DesktopError::ExternalChange)));
        assert_eq!(
            fs::read(&path).expect("external generation should remain"),
            external
        );
        assert!(service.snapshot().expect("local state should remain").dirty);
    }

    #[cfg(unix)]
    #[test]
    fn reload_swaps_only_after_a_candidate_opens_and_projects() {
        let (_directory, path, mut service) = isolated_service();
        let entry_id = mutate_first_title(&mut service, "local B");
        write_external_version(&path, "external C");

        assert!(matches!(
            service.reload(SecretString::new("wrong-password".to_owned())),
            Err(DesktopError::ReloadFailed)
        ));
        assert!(
            service
                .snapshot()
                .expect("wrong-password local state")
                .dirty
        );
        assert_eq!(
            service
                .entry_title(&entry_id)
                .expect("wrong-password local title")
                .expose_secret(),
            "local B"
        );

        let reloaded = service.reload(credential()).expect("reload should succeed");
        assert!(!reloaded.dirty);
        assert_eq!(
            service
                .entry_title(&entry_id)
                .expect("external title should load")
                .expose_secret(),
            "external C"
        );
    }

    #[cfg(unix)]
    #[test]
    fn corrupt_reload_preserves_dirty_local_session_and_external_bytes() {
        let (_directory, path, mut service) = isolated_service();
        let entry_id = mutate_first_title(&mut service, "local survives corruption");
        let corrupt = b"not a KDBX file";
        fs::write(&path, corrupt).expect("external corruption should be written");

        assert!(matches!(
            service.reload(credential()),
            Err(DesktopError::ReloadFailed)
        ));
        assert_eq!(
            fs::read(&path).expect("corrupt source should remain"),
            corrupt
        );
        assert!(service.snapshot().expect("local state should remain").dirty);
        assert_eq!(
            service
                .entry_title(&entry_id)
                .expect("local title should remain")
                .expose_secret(),
            "local survives corruption"
        );
    }

    #[test]
    fn serialized_snapshot_has_only_reviewed_presentation_keys() {
        let mut service = selected_service();
        let snapshot = service
            .unlock(SecretString::new(FIXTURE_PASSWORD.to_owned()))
            .expect("trusted fixture should unlock");
        let serialized = to_value(snapshot).expect("snapshot should serialize");

        assert!(!serialized.to_string().contains(FIXTURE_PASSWORD));
        assert_reviewed_keys(&serialized);
    }

    #[test]
    fn entry_detail_is_secret_free_and_unknown_ids_are_typed() {
        let mut service = selected_service();
        unlock(&mut service);
        let snapshot = service.snapshot().expect("snapshot should exist");
        let entry_id = &snapshot.entries.first().expect("fixture entry").id;
        let detail = service.entry_detail(entry_id).expect("detail should exist");
        let serialized = to_value(detail)
            .expect("detail should serialize")
            .to_string();
        assert!(!serialized.contains(FIXTURE_PASSWORD));
        assert!(!serialized.contains("\"password\":"));
        assert!(!serialized.contains("\"notes\":"));
        assert!(matches!(
            service.entry_detail("00000000-0000-0000-0000-000000000000"),
            Err(DesktopError::EntryNotFound)
        ));
    }

    #[test]
    fn narrow_password_notes_and_username_reads_preserve_secret_boundary() {
        let mut service = selected_service();
        unlock(&mut service);
        let snapshot = service.snapshot().expect("snapshot should exist");
        let password_entry = snapshot
            .entries
            .iter()
            .find(|entry| entry.password_present)
            .expect("fixture should contain a password");
        assert!(
            !service
                .entry_password(&password_entry.id)
                .expect("password should resolve")
                .expose_secret()
                .is_empty()
        );

        let notes_entry = snapshot
            .entries
            .iter()
            .find(|entry| entry.notes_present)
            .expect("fixture should contain notes");
        assert!(service.entry_notes(&notes_entry.id).is_ok());

        let username_entry = snapshot
            .entries
            .iter()
            .find(|entry| !matches!(entry.username, crate::dto::SummaryTextDto::Missing))
            .expect("fixture should contain a username");
        assert!(service.entry_username(&username_entry.id).is_ok());
        let session = service
            .session
            .as_mut()
            .expect("session should be unlocked");
        let root_id = session
            .projection()
            .expect("fixture should project")
            .root()
            .id()
            .clone();
        let missing_password = session
            .document_mut()
            .create_entry(
                &root_id,
                NewEntry {
                    title: "No password",
                    username: "synthetic-user",
                    url: "",
                    password: None,
                },
            )
            .expect("test entry should be created");
        assert!(matches!(
            service.entry_password(missing_password.as_str()),
            Err(DesktopError::SecretUnavailable)
        ));
        assert!(matches!(
            service.entry_password("00000000-0000-0000-0000-000000000000"),
            Err(DesktopError::EntryNotFound)
        ));
    }

    #[test]
    fn standalone_generator_copy_is_unlock_scoped_validated_and_lease_owned() {
        let locked_clipboard = Arc::new(TestClipboard::default());
        let locked = AppState::new(locked_clipboard.clone());
        assert!(matches!(
            locked.copy_generated_password(SecretString::new("synthetic-value".to_owned())),
            Err(DesktopError::Locked)
        ));
        assert!(
            locked_clipboard
                .content
                .lock()
                .expect("clipboard")
                .is_none()
        );

        let (state, clipboard, _) = unlocked_app();
        for invalid in [
            String::new(),
            "has\nnewline".to_owned(),
            "contains\tcontrol".to_owned(),
            "outside-ascii-ö".to_owned(),
            "X".repeat(257),
        ] {
            assert!(matches!(
                state.copy_generated_password(SecretString::new(invalid)),
                Err(DesktopError::InvalidRequest)
            ));
        }
        assert!(clipboard.content.lock().expect("clipboard").is_none());

        let original = state
            .copy_generated_password(SecretString::new("first-password".to_owned()))
            .expect("generated clipboard write");
        assert_eq!(original.expires_in_ms, crate::clipboard::CLIPBOARD_CLEAR_MS);
        let subsequent = state
            .copy_generated_password(SecretString::new("second-password".to_owned()))
            .expect("replacement clipboard write");
        assert!(
            matches!(
                state.clipboard.expire_generation(original.generation),
                ClipboardClearStatus::NotOwned
            ),
            "an older timer must not clear the new generated password"
        );
        assert_eq!(
            clipboard.content.lock().expect("clipboard").as_deref(),
            Some("second-password")
        );
        assert!(matches!(
            state.clipboard.expire_generation(subsequent.generation),
            ClipboardClearStatus::Cleared
        ));
        assert!(clipboard.content.lock().expect("clipboard").is_none());
    }

    #[test]
    fn semantic_copy_commands_write_secrets_but_return_only_safe_receipts() {
        let (state, clipboard, entry_id) = unlocked_app();
        let expected_password = state
            .service
            .lock()
            .expect("desktop service lock")
            .entry_password(&entry_id)
            .expect("fixture password")
            .expose_secret()
            .to_owned();
        let receipt = state
            .copy_entry_password(&entry_id)
            .expect("password copy should succeed");
        assert!(receipt.generation > 0);
        assert_eq!(
            clipboard.content.lock().expect("clipboard lock").as_deref(),
            Some(expected_password.as_str())
        );

        let expected_title = state
            .service
            .lock()
            .expect("desktop service lock")
            .entry_title(&entry_id)
            .expect("fixture title")
            .expose_secret()
            .to_owned();
        state
            .copy_entry_title(&entry_id)
            .expect("title copy should succeed");
        assert_eq!(
            clipboard.content.lock().expect("clipboard lock").as_deref(),
            Some(expected_title.as_str())
        );

        let expected_username = state
            .service
            .lock()
            .expect("desktop service lock")
            .entry_username(&entry_id)
            .expect("fixture username")
            .expose_secret()
            .to_owned();
        state
            .copy_entry_username(&entry_id)
            .expect("username copy should succeed");
        assert_eq!(
            clipboard.content.lock().expect("clipboard lock").as_deref(),
            Some(expected_username.as_str())
        );

        let expected_url = state
            .service
            .lock()
            .expect("desktop service lock")
            .entry_url(&entry_id)
            .expect("fixture URL")
            .expose_secret()
            .to_owned();
        state
            .copy_entry_url(&entry_id)
            .expect("URL copy should succeed");
        assert_eq!(
            clipboard.content.lock().expect("clipboard lock").as_deref(),
            Some(expected_url.as_str())
        );

        let expected_notes = state
            .service
            .lock()
            .expect("desktop service lock")
            .entry_notes(&entry_id)
            .expect("fixture notes")
            .expose_secret()
            .to_owned();
        state
            .copy_entry_notes(&entry_id)
            .expect("notes copy should succeed");
        assert_eq!(
            clipboard.content.lock().expect("clipboard lock").as_deref(),
            Some(expected_notes.as_str())
        );

        let custom_value = "custom clipboard value";
        state
            .service
            .lock()
            .expect("desktop service lock")
            .session_mut()
            .expect("fixture session")
            .set_entry_custom_field(
                &EntryId::new(entry_id.clone()),
                "Private",
                &SecretString::new(custom_value.to_owned()),
                FieldProtection::Protected,
            )
            .expect("custom field should be writable");
        state
            .copy_entry_custom_field(&entry_id, "Private")
            .expect("custom field copy should succeed");
        assert_eq!(
            clipboard.content.lock().expect("clipboard lock").as_deref(),
            Some(custom_value)
        );
    }

    #[test]
    fn copy_wins_lifecycle_gate_then_lock_clears_the_owned_clipboard() {
        let (write_started_tx, write_started_rx) = sync_channel(1);
        let (allow_write_tx, allow_write_rx) = sync_channel(1);
        let clipboard = Arc::new(BlockingWriteClipboard {
            content: Mutex::new(None),
            write_started: write_started_tx,
            allow_write: Mutex::new(allow_write_rx),
        });
        let (state, entry_id) = unlocked_state(clipboard.clone());

        let copy_state = state.clone();
        let copy_thread = thread::spawn(move || copy_state.copy_entry_password(&entry_id));
        write_started_rx
            .recv_timeout(TEST_COORDINATION_TIMEOUT)
            .expect("copy should reach the controlled clipboard write");
        assert!(matches!(
            state.secret_operation_gate.try_lock(),
            Err(TryLockError::WouldBlock)
        ));
        assert!(
            state
                .service
                .try_lock()
                .expect("copy must release the service mutex before clipboard I/O")
                .snapshot()
                .is_ok()
        );

        let (lock_attempt_tx, lock_attempt_rx) = sync_channel(1);
        let (lock_done_tx, lock_done_rx) = sync_channel(1);
        let lock_state = state.clone();
        let lock_thread = thread::spawn(move || {
            lock_attempt_tx.send(()).expect("report lock attempt");
            let result = lock_state.lock();
            lock_done_tx.send(result).expect("report lock result");
        });
        lock_attempt_rx
            .recv_timeout(TEST_COORDINATION_TIMEOUT)
            .expect("lock worker should start");
        assert!(matches!(lock_done_rx.try_recv(), Err(TryRecvError::Empty)));

        allow_write_tx.send(()).expect("release clipboard write");
        copy_thread
            .join()
            .expect("copy worker should not panic")
            .expect("copy should finish before lock");
        let lock_status = lock_done_rx
            .recv_timeout(TEST_COORDINATION_TIMEOUT)
            .expect("lock should finish after the copy")
            .expect("lock should succeed");
        lock_thread.join().expect("lock worker should not panic");

        assert!(lock_status == ClipboardClearStatus::Cleared);
        assert!(clipboard.content.lock().expect("clipboard lock").is_none());
        assert!(matches!(
            state
                .service
                .lock()
                .expect("desktop service lock")
                .snapshot(),
            Err(DesktopError::Locked)
        ));
    }

    fn assert_lock_wins_before_copy(password: bool) {
        let (read_started_tx, read_started_rx) = sync_channel(1);
        let (allow_read_tx, allow_read_rx) = sync_channel(1);
        let clipboard = Arc::new(BlockingReadClipboard {
            content: Mutex::new(None),
            block_read: AtomicBool::new(false),
            read_started: read_started_tx,
            allow_read: Mutex::new(allow_read_rx),
        });
        let (state, entry_id) = unlocked_state(clipboard.clone());
        state
            .copy_entry_password(&entry_id)
            .expect("initial copy should install an owned lease");
        clipboard.block_read.store(true, Ordering::SeqCst);

        let (lock_done_tx, lock_done_rx) = sync_channel(1);
        let lock_state = state.clone();
        let lock_thread = thread::spawn(move || {
            lock_done_tx
                .send(lock_state.lock())
                .expect("report lock result");
        });
        read_started_rx
            .recv_timeout(TEST_COORDINATION_TIMEOUT)
            .expect("lock should drop the session and reach clipboard verification");
        assert!(matches!(
            state.secret_operation_gate.try_lock(),
            Err(TryLockError::WouldBlock)
        ));
        assert!(matches!(
            state
                .service
                .try_lock()
                .expect("lock must release the service mutex before clipboard I/O")
                .snapshot(),
            Err(DesktopError::Locked)
        ));

        let (copy_attempt_tx, copy_attempt_rx) = sync_channel(1);
        let (copy_done_tx, copy_done_rx) = sync_channel(1);
        let copy_state = state.clone();
        let copy_thread = thread::spawn(move || {
            copy_attempt_tx.send(()).expect("report copy attempt");
            let result = if password {
                copy_state.copy_entry_password(&entry_id)
            } else {
                copy_state.copy_entry_username(&entry_id)
            };
            copy_done_tx.send(result).expect("report copy result");
        });
        copy_attempt_rx
            .recv_timeout(TEST_COORDINATION_TIMEOUT)
            .expect("copy worker should start");
        assert!(matches!(copy_done_rx.try_recv(), Err(TryRecvError::Empty)));

        allow_read_tx
            .send(())
            .expect("release clipboard verification");
        assert!(
            lock_done_rx
                .recv_timeout(TEST_COORDINATION_TIMEOUT)
                .expect("lock should finish")
                .expect("lock should succeed")
                == ClipboardClearStatus::Cleared
        );
        assert!(matches!(
            copy_done_rx
                .recv_timeout(TEST_COORDINATION_TIMEOUT)
                .expect("copy should finish after lock"),
            Err(DesktopError::Locked)
        ));
        lock_thread.join().expect("lock worker should not panic");
        copy_thread.join().expect("copy worker should not panic");
        assert!(clipboard.content.lock().expect("clipboard lock").is_none());
    }

    #[test]
    fn lock_wins_lifecycle_gate_before_password_and_username_copy() {
        assert_lock_wins_before_copy(true);
        assert_lock_wins_before_copy(false);
    }

    #[test]
    fn lock_preserves_replaced_clipboard_and_always_drops_session() {
        let (state, clipboard, entry_id) = unlocked_app();
        state
            .copy_entry_password(&entry_id)
            .expect("password copy should succeed");
        *clipboard.content.lock().expect("clipboard lock") = Some("user-copy-b".to_owned());
        assert!(state.lock().expect("lock should succeed") == ClipboardClearStatus::NotOwned);
        assert_eq!(
            clipboard.content.lock().expect("clipboard lock").as_deref(),
            Some("user-copy-b")
        );
        assert!(matches!(
            state
                .service
                .lock()
                .expect("desktop service lock")
                .snapshot(),
            Err(DesktopError::Locked)
        ));
    }

    #[test]
    fn lock_clears_an_owned_clipboard_and_drops_session() {
        let (state, clipboard, entry_id) = unlocked_app();
        state
            .copy_entry_password(&entry_id)
            .expect("password copy should succeed");
        assert!(state.lock().expect("lock should succeed") == ClipboardClearStatus::Cleared);
        assert!(clipboard.content.lock().expect("clipboard lock").is_none());
        assert!(matches!(
            state
                .service
                .lock()
                .expect("desktop service lock")
                .snapshot(),
            Err(DesktopError::Locked)
        ));
    }

    #[test]
    fn clipboard_clear_failure_cannot_prevent_lock() {
        let (state, clipboard, entry_id) = unlocked_app();
        state
            .copy_entry_password(&entry_id)
            .expect("password copy should succeed");
        *clipboard.fail_clear.lock().expect("clipboard lock") = true;
        assert!(
            state.lock().expect("session lock should succeed") == ClipboardClearStatus::ClearFailed
        );
        assert!(matches!(
            state
                .service
                .lock()
                .expect("desktop service lock")
                .snapshot(),
            Err(DesktopError::Locked)
        ));
    }

    fn assert_reviewed_keys(value: &Value) {
        let root = value.as_object().expect("snapshot should be an object");
        assert_exact_keys(
            root,
            &[
                "dirty",
                "fileName",
                "capabilities",
                "recycleBinEnabled",
                "recycleBinGroupId",
                "rootGroupId",
                "groups",
                "entries",
            ],
        );
        assert_exact_keys(
            root["capabilities"]
                .as_object()
                .expect("capabilities should be an object"),
            &["formatVersion", "writable", "writeRestriction"],
        );

        for group in root["groups"]
            .as_array()
            .expect("groups should be an array")
        {
            assert_exact_keys(
                group.as_object().expect("group should be an object"),
                &["id", "name", "childGroupIds", "entryIds"],
            );
        }

        for entry in root["entries"]
            .as_array()
            .expect("entries should be an array")
        {
            let entry = entry.as_object().expect("entry should be an object");
            assert_exact_keys(
                entry,
                &[
                    "id",
                    "groupId",
                    "title",
                    "username",
                    "url",
                    "passwordPresent",
                    "notesPresent",
                    "totpPresent",
                    "expiresAtUnixSeconds",
                    "icon",
                    "tags",
                ],
            );
            for field in ["title", "username", "url"] {
                let summary = entry[field]
                    .as_object()
                    .expect("summary should be an object");
                let kind = summary["kind"].as_str().expect("summary kind should exist");
                match kind {
                    "visible" => assert_exact_keys(summary, &["kind", "value"]),
                    "missing" | "protected" => assert_exact_keys(summary, &["kind"]),
                    _ => panic!("unknown summary kind"),
                }
            }
        }
    }

    fn assert_exact_keys(object: &Map<String, Value>, expected: &[&str]) {
        assert_eq!(object.len(), expected.len());
        for key in expected {
            assert!(object.contains_key(*key), "missing reviewed DTO key");
        }
    }
}
