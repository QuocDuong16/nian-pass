use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use vault_core::{EntryId, SecretString};
use vault_session::{SessionError, VaultSession};

use crate::{
    clipboard::{
        ClipboardClearStatus, ClipboardCopy, ClipboardFailure, ClipboardPort,
        DesktopClipboardService,
    },
    dto::{EntryDetailDto, SelectedVaultDto, VaultSnapshotDto},
};

/// Stable public failures. No variant carries a path, parser detail, or secret.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DesktopError {
    AlreadyUnlocked,
    Locked,
    NoVaultSelected,
    UnlockFailed,
    UnsupportedVault,
    EntryNotFound,
    SecretUnavailable,
    ClipboardFailed,
    Internal,
}

/// Rust-owned desktop state with at most one unlocked session.
pub struct DesktopVaultService {
    selected_path: Option<PathBuf>,
    session: Option<VaultSession>,
}

impl DesktopVaultService {
    #[must_use]
    pub const fn new() -> Self {
        Self {
            selected_path: None,
            session: None,
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
            .map(|vault| VaultSnapshotDto::from_vault(&vault))
            .map_err(map_open_error)?;
        self.session = Some(session);
        Ok(snapshot)
    }

    pub fn snapshot(&self) -> Result<VaultSnapshotDto, DesktopError> {
        let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
        session
            .projection()
            .map(|vault| VaultSnapshotDto::from_vault(&vault))
            .map_err(|_| DesktopError::Internal)
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
        let session = self.session.take().ok_or(DesktopError::Locked)?;
        session.lock();
        self.selected_path = None;
        Ok(())
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
}

impl AppState {
    #[must_use]
    pub fn new(clipboard: Arc<dyn ClipboardPort>) -> Self {
        Self {
            service: Arc::new(Mutex::new(DesktopVaultService::new())),
            clipboard: Arc::new(DesktopClipboardService::new(clipboard)),
            secret_operation_gate: Arc::new(Mutex::new(())),
        }
    }

    pub fn copy_entry_password(&self, entry_id: &str) -> Result<ClipboardCopy, DesktopError> {
        self.copy_entry_secret(entry_id, DesktopVaultService::entry_password)
    }

    pub fn copy_entry_username(&self, entry_id: &str) -> Result<ClipboardCopy, DesktopError> {
        self.copy_entry_secret(entry_id, DesktopVaultService::entry_username)
    }

    pub fn lock(&self) -> Result<ClipboardClearStatus, DesktopError> {
        let _operation = self
            .secret_operation_gate
            .lock()
            .map_err(|_| DesktopError::Internal)?;
        {
            let mut service = self.service.lock().map_err(|_| DesktopError::Internal)?;
            service.lock()?;
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

fn display_file_name(path: &Path) -> Option<String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
}

fn map_open_error(error: SessionError) -> DesktopError {
    if error.is_open_credential_rejected() {
        DesktopError::UnlockFailed
    } else if error.is_unsupported_open_target() {
        DesktopError::UnsupportedVault
    } else {
        DesktopError::Internal
    }
}

fn map_clipboard_error(_error: ClipboardFailure) -> DesktopError {
    DesktopError::ClipboardFailed
}

#[cfg(test)]
mod tests {
    use std::{
        path::{Path, PathBuf},
        sync::{
            Arc, Mutex, TryLockError,
            atomic::{AtomicBool, Ordering},
            mpsc::{Receiver, SyncSender, TryRecvError, sync_channel},
        },
        thread,
        time::Duration,
    };

    use serde_json::{Map, Value, to_value};
    use vault_core::{NewEntry, SecretString};

    use super::{AppState, DesktopError, DesktopVaultService};
    use crate::clipboard::{ClipboardClearStatus, ClipboardPort};

    const FIXTURE_PASSWORD: &str = "demopass";
    const FIXTURE: &str = "keepassxc-2.7.12-kdbx41.kdbx";
    const TEST_COORDINATION_TIMEOUT: Duration = Duration::from_secs(3);

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
        assert_exact_keys(root, &["rootGroupId", "groups", "entries"]);

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
