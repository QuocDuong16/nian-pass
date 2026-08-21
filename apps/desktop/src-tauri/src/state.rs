use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use vault_core::SecretString;
use vault_session::{SessionError, VaultSession};

use crate::dto::{SelectedVaultDto, VaultSnapshotDto};

/// Stable public failures. No variant carries a path, parser detail, or secret.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum DesktopError {
    AlreadyUnlocked,
    Locked,
    NoVaultSelected,
    UnlockFailed,
    UnsupportedVault,
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

    pub fn lock(&mut self) -> Result<(), DesktopError> {
        let session = self.session.take().ok_or(DesktopError::Locked)?;
        session.lock();
        self.selected_path = None;
        Ok(())
    }
}

impl Default for DesktopVaultService {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone, Default)]
pub struct AppState {
    pub service: Arc<Mutex<DesktopVaultService>>,
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

#[cfg(test)]
mod tests {
    use std::path::{Path, PathBuf};

    use serde_json::{Map, Value, to_value};
    use vault_core::SecretString;

    use super::{DesktopError, DesktopVaultService};

    const FIXTURE_PASSWORD: &str = "demopass";
    const FIXTURE: &str = "keepassxc-2.7.12-kdbx41.kdbx";

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
