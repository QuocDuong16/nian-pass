use std::sync::{Arc, Mutex};

use sha2::{Digest, Sha256};
use tauri::{AppHandle, Runtime};
use tauri_plugin_clipboard_manager::ClipboardExt;
use vault_core::SecretString;

pub const CLIPBOARD_CLEAR_MS: u64 = 30_000;
const FINGERPRINT_BYTES: usize = 32;

pub trait ClipboardPort: Send + Sync {
    fn write_text(&self, value: &str) -> Result<(), ()>;
    fn read_text(&self) -> Result<Option<String>, ()>;
    fn clear(&self) -> Result<(), ()>;
}

pub struct TauriClipboard<R: Runtime> {
    app: AppHandle<R>,
}

impl<R: Runtime> TauriClipboard<R> {
    #[must_use]
    pub const fn new(app: AppHandle<R>) -> Self {
        Self { app }
    }
}

impl<R: Runtime> ClipboardPort for TauriClipboard<R> {
    fn write_text(&self, value: &str) -> Result<(), ()> {
        self.app.clipboard().write_text(value).map_err(|_| ())
    }

    fn read_text(&self) -> Result<Option<String>, ()> {
        self.app.clipboard().read_text().map(Some).map_err(|_| ())
    }

    fn clear(&self) -> Result<(), ()> {
        self.app.clipboard().clear().map_err(|_| ())
    }
}

#[derive(Clone, Copy, Eq, PartialEq)]
pub enum ClipboardClearStatus {
    Cleared,
    NotOwned,
    ClearFailed,
}

pub struct ClipboardCopy {
    pub generation: u64,
    pub expires_in_ms: u64,
}

pub enum ClipboardFailure {
    Unavailable,
    Internal,
}

struct ClipboardLease {
    generation: u64,
    salt: [u8; FINGERPRINT_BYTES],
    digest: [u8; FINGERPRINT_BYTES],
}

#[derive(Default)]
struct ClipboardState {
    generation: u64,
    lease: Option<ClipboardLease>,
}

pub struct DesktopClipboardService {
    port: Arc<dyn ClipboardPort>,
    state: Mutex<ClipboardState>,
}

impl DesktopClipboardService {
    #[must_use]
    pub fn new(port: Arc<dyn ClipboardPort>) -> Self {
        Self {
            port,
            state: Mutex::new(ClipboardState::default()),
        }
    }

    pub fn copy(&self, value: &SecretString) -> Result<ClipboardCopy, ClipboardFailure> {
        let mut salt = [0_u8; FINGERPRINT_BYTES];
        getrandom::fill(&mut salt).map_err(|_| ClipboardFailure::Internal)?;
        let digest = fingerprint(&salt, value.expose_secret());
        let mut state = self.state.lock().map_err(|_| ClipboardFailure::Internal)?;
        let generation = state
            .generation
            .checked_add(1)
            .ok_or(ClipboardFailure::Internal)?;

        self.port
            .write_text(value.expose_secret())
            .map_err(|()| ClipboardFailure::Unavailable)?;
        state.generation = generation;
        state.lease = Some(ClipboardLease {
            generation,
            salt,
            digest,
        });
        Ok(ClipboardCopy {
            generation,
            expires_in_ms: CLIPBOARD_CLEAR_MS,
        })
    }

    pub fn expire_generation(&self, generation: u64) -> ClipboardClearStatus {
        self.clear_owned(Some(generation))
    }

    pub fn clear_if_owned(&self) -> ClipboardClearStatus {
        self.clear_owned(None)
    }

    fn clear_owned(&self, expected_generation: Option<u64>) -> ClipboardClearStatus {
        let Ok(mut state) = self.state.lock() else {
            return ClipboardClearStatus::ClearFailed;
        };
        let Some(lease) = state.lease.as_ref() else {
            return ClipboardClearStatus::NotOwned;
        };
        let generation = lease.generation;
        let salt = lease.salt;
        let digest = lease.digest;
        if expected_generation.is_some_and(|expected| expected != generation) {
            return ClipboardClearStatus::NotOwned;
        }

        let current = match self.port.read_text() {
            Ok(current) => current,
            Err(()) => {
                state.lease = None;
                return ClipboardClearStatus::ClearFailed;
            }
        };
        let matches = current.is_some_and(|current| {
            let current = SecretString::new(current);
            fingerprint(&salt, current.expose_secret()) == digest
        });
        if !matches {
            state.lease = None;
            return ClipboardClearStatus::NotOwned;
        }
        if self.port.clear().is_err() {
            state.lease = None;
            return ClipboardClearStatus::ClearFailed;
        }
        state.lease = None;
        ClipboardClearStatus::Cleared
    }
}

fn fingerprint(salt: &[u8; FINGERPRINT_BYTES], value: &str) -> [u8; FINGERPRINT_BYTES] {
    let mut digest = Sha256::new();
    digest.update(salt);
    digest.update(value.as_bytes());
    digest.finalize().into()
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use vault_core::SecretString;

    use super::{
        ClipboardClearStatus, ClipboardFailure, ClipboardPort, DesktopClipboardService,
        FINGERPRINT_BYTES, fingerprint,
    };

    #[derive(Default)]
    struct FakeClipboard {
        content: Mutex<Option<String>>,
        fail_write: Mutex<bool>,
        fail_read: Mutex<bool>,
        fail_clear: Mutex<bool>,
    }

    impl FakeClipboard {
        fn content(&self) -> Option<String> {
            self.content.lock().expect("fake clipboard lock").clone()
        }

        fn external_write(&self, value: &str) {
            *self.content.lock().expect("fake clipboard lock") = Some(value.to_owned());
        }
    }

    impl ClipboardPort for FakeClipboard {
        fn write_text(&self, value: &str) -> Result<(), ()> {
            if *self.fail_write.lock().map_err(|_| ())? {
                return Err(());
            }
            *self.content.lock().map_err(|_| ())? = Some(value.to_owned());
            Ok(())
        }

        fn read_text(&self) -> Result<Option<String>, ()> {
            if *self.fail_read.lock().map_err(|_| ())? {
                return Err(());
            }
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

    fn setup() -> (Arc<FakeClipboard>, DesktopClipboardService) {
        let clipboard = Arc::new(FakeClipboard::default());
        let service = DesktopClipboardService::new(clipboard.clone());
        (clipboard, service)
    }

    fn copy(service: &DesktopClipboardService, value: &str) -> u64 {
        let Ok(copy) = service.copy(&SecretString::new(value.to_owned())) else {
            panic!("fake clipboard copy should succeed");
        };
        copy.generation
    }

    #[test]
    fn fingerprint_matches_only_same_salt_and_content() {
        let salt = [7_u8; FINGERPRINT_BYTES];
        assert_eq!(fingerprint(&salt, "alpha"), fingerprint(&salt, "alpha"));
        assert_ne!(fingerprint(&salt, "alpha"), fingerprint(&salt, "beta"));
        assert_ne!(
            fingerprint(&salt, "alpha"),
            fingerprint(&[8_u8; FINGERPRINT_BYTES], "alpha")
        );
    }

    #[test]
    fn copy_and_owned_expiration_clear_the_clipboard() {
        let (clipboard, service) = setup();
        let generation = copy(&service, "synthetic-password-a");
        assert_eq!(clipboard.content().as_deref(), Some("synthetic-password-a"));
        assert!(service.expire_generation(generation) == ClipboardClearStatus::Cleared);
        assert!(clipboard.content().is_none());
    }

    #[test]
    fn external_clipboard_replacement_is_preserved() {
        let (clipboard, service) = setup();
        let generation = copy(&service, "synthetic-password-a");
        clipboard.external_write("unrelated-user-content-b");
        assert!(service.expire_generation(generation) == ClipboardClearStatus::NotOwned);
        assert_eq!(
            clipboard.content().as_deref(),
            Some("unrelated-user-content-b")
        );
    }

    #[test]
    fn old_generation_cannot_clear_a_new_copy() {
        let (clipboard, service) = setup();
        let first = copy(&service, "synthetic-password-a");
        let second = copy(&service, "synthetic-password-b");
        assert!(service.expire_generation(first) == ClipboardClearStatus::NotOwned);
        assert_eq!(clipboard.content().as_deref(), Some("synthetic-password-b"));
        assert!(service.expire_generation(second) == ClipboardClearStatus::Cleared);
        assert!(clipboard.content().is_none());
    }

    #[test]
    fn failed_write_installs_no_new_lease() {
        let (clipboard, service) = setup();
        *clipboard.fail_write.lock().expect("fake clipboard lock") = true;
        assert!(matches!(
            service.copy(&SecretString::new("synthetic-password".to_owned())),
            Err(ClipboardFailure::Unavailable)
        ));
        assert!(service.clear_if_owned() == ClipboardClearStatus::NotOwned);
    }

    #[test]
    fn read_failure_relinquishes_ownership() {
        let (clipboard, service) = setup();
        copy(&service, "synthetic-password");
        *clipboard.fail_read.lock().expect("fake clipboard lock") = true;
        assert!(service.clear_if_owned() == ClipboardClearStatus::ClearFailed);
        *clipboard.fail_read.lock().expect("fake clipboard lock") = false;
        assert!(service.clear_if_owned() == ClipboardClearStatus::NotOwned);
        assert_eq!(clipboard.content().as_deref(), Some("synthetic-password"));
    }

    #[test]
    fn clear_failure_relinquishes_ownership() {
        let (clipboard, service) = setup();
        copy(&service, "synthetic-password");
        *clipboard.fail_clear.lock().expect("fake clipboard lock") = true;
        assert!(service.clear_if_owned() == ClipboardClearStatus::ClearFailed);
        *clipboard.fail_clear.lock().expect("fake clipboard lock") = false;
        assert!(service.clear_if_owned() == ClipboardClearStatus::NotOwned);
        assert_eq!(clipboard.content().as_deref(), Some("synthetic-password"));
    }
}
