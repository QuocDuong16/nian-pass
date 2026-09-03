use std::path::PathBuf;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

use vault_core::{EntryId, SecretString};
use vault_session::VaultSession;

mod browser;
mod error;
mod sync_support;

pub use error::DesktopError;
pub(crate) use error::map_mutation_error;
use error::{map_clipboard_error, map_open_error, map_provider_error, map_save_error};

use crate::{
    clipboard::{ClipboardClearStatus, ClipboardCopy, ClipboardPort, DesktopClipboardService},
    dto::{ClosePolicyDto, EntryDetailDto, SelectedVaultDto, VaultSnapshotDto},
};

/// Rust-owned desktop state with at most one unlocked session.
pub struct DesktopVaultService {
    selected_path: Option<PathBuf>,
    session: Option<VaultSession>,
    browser_session_id: Option<String>,
}

impl DesktopVaultService {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            selected_path: None,
            session: None,
            browser_session_id: None,
        }
    }

    pub fn select_path(&mut self, path: PathBuf) -> Result<SelectedVaultDto, DesktopError> {
        if self.session.is_some() {
            return Err(DesktopError::AlreadyUnlocked);
        }

        let file_name = display_file_name(&path).ok_or(DesktopError::UnsupportedVault)?;
        self.selected_path = Some(path);
        Ok(SelectedVaultDto { file_name })
    }

    pub fn unlock(&mut self, credential: SecretString) -> Result<VaultSnapshotDto, DesktopError> {
        if self.session.is_some() {
            return Err(DesktopError::AlreadyUnlocked);
        }

        let path = self
            .selected_path
            .as_deref()
            .ok_or(DesktopError::NoVaultSelected)?;
        let session = VaultSession::open(path, &credential).map_err(map_open_error)?;
        let snapshot = session
            .projection()
            .map(|vault| VaultSnapshotDto::from_vault(&vault, session.is_dirty()))
            .map_err(map_open_error)?;
        let browser_session_id = random_process_token()?;
        self.session = Some(session);
        self.browser_session_id = Some(browser_session_id);
        Ok(snapshot)
    }

    pub fn snapshot(&self) -> Result<VaultSnapshotDto, DesktopError> {
        let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
        session
            .projection()
            .map(|vault| VaultSnapshotDto::from_vault(&vault, session.is_dirty()))
            .map_err(|_| DesktopError::Internal)
    }

    pub fn save(&mut self, credential: SecretString) -> Result<VaultSnapshotDto, DesktopError> {
        let session = self.session.as_mut().ok_or(DesktopError::Locked)?;
        session.save(&credential).map_err(map_save_error)?;
        self.snapshot()
    }

    pub fn reload(&mut self, credential: SecretString) -> Result<VaultSnapshotDto, DesktopError> {
        let path = self
            .session
            .as_ref()
            .ok_or(DesktopError::Locked)?
            .path()
            .to_owned();
        let candidate =
            VaultSession::open(path, &credential).map_err(|_| DesktopError::ReloadFailed)?;
        let snapshot = candidate
            .projection()
            .map(|vault| VaultSnapshotDto::from_vault(&vault, candidate.is_dirty()))
            .map_err(|_| DesktopError::ReloadFailed)?;
        let browser_session_id = random_process_token()?;
        self.session = Some(candidate);
        self.browser_session_id = Some(browser_session_id);
        Ok(snapshot)
    }

    pub(crate) fn session_mut(&mut self) -> Result<&mut VaultSession, DesktopError> {
        self.session.as_mut().ok_or(DesktopError::Locked)
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

    pub fn copy_entry_username(&self, entry_id: &str) -> Result<ClipboardCopy, DesktopError> {
        self.copy_entry_secret(entry_id, DesktopVaultService::entry_username)
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
        // Lock order is operation gate -> vault service. Clipboard state is
        // touched only after the vault-service guard has been released.
        let _operation = self
            .secret_operation_gate
            .lock()
            .map_err(|_| DesktopError::Internal)?;
        let secret = {
            let service = self.service.lock().map_err(|_| DesktopError::Internal)?;
            read(&service, entry_id)?
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
    use serde_json::{Map, Value, to_value};
    use vault_core::{EntryId, NewEntry, SecretString};
    use vault_session::VaultSession;

    use vault_session::SessionError;

    use super::{AppState, DesktopError, DesktopVaultService, map_save_error};
    use crate::clipboard::{ClipboardClearStatus, ClipboardPort};

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

        let saved = service
            .save(credential())
            .expect("desktop save should succeed");
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
        assert!(
            !service
                .save(credential())
                .expect("second save should succeed")
                .dirty
        );
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

        assert!(matches!(
            service.save(SecretString::new("wrong-password".to_owned())),
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
        assert!(
            !service
                .save(credential())
                .expect("valid retry should succeed")
                .dirty
        );
    }

    #[cfg(unix)]
    #[test]
    fn external_change_and_deletion_are_fail_closed_without_losing_local_edits() {
        let (_directory, path, mut service) = isolated_service();
        let entry_id = mutate_first_title(&mut service, "local B");
        write_external_version(&path, "external C");
        let external = fs::read(&path).expect("external source should be readable");

        assert!(matches!(
            service.save(credential()),
            Err(DesktopError::ExternalChange)
        ));
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
        assert!(matches!(
            service.save(credential()),
            Err(DesktopError::ExternalChange)
        ));
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
        service
            .save(credential())
            .expect("first save should succeed");
        write_external_version(&path, "external after S1");
        let external = fs::read(&path).expect("external generation should be readable");
        mutate_first_title(&mut service, "local after S1");

        assert!(matches!(
            service.save(credential()),
            Err(DesktopError::ExternalChange)
        ));
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
        assert_exact_keys(root, &["dirty", "rootGroupId", "groups", "entries"]);

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
