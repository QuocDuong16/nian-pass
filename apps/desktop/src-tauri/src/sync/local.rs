use std::sync::{Arc, Mutex};

use sync_engine::{LocalCommitError, LocalSnapshot, LocalVault, SourceBinding};
use vault_core::SecretString;

use crate::state::{DesktopError, DesktopVaultService};

pub struct DesktopLocal {
    service: Arc<Mutex<DesktopVaultService>>,
}

impl DesktopLocal {
    pub const fn new(service: Arc<Mutex<DesktopVaultService>>) -> Self {
        Self { service }
    }
}

impl LocalVault for DesktopLocal {
    fn capture_clean(&self) -> Result<LocalSnapshot, LocalCommitError> {
        let capture = self
            .service
            .lock()
            .map_err(|_| LocalCommitError::Failed)?
            .sync_capture()
            .map_err(map_desktop_error)?;
        let source = SourceBinding::from_sha256(capture.source_binding)
            .map_err(|_| LocalCommitError::Failed)?;
        Ok(LocalSnapshot::new(
            source,
            capture.authority,
            capture.ciphertext,
        ))
    }

    fn replace_if_unchanged(
        &self,
        expected: &LocalSnapshot,
        ciphertext: &[u8],
        master_password: &SecretString,
    ) -> Result<(), LocalCommitError> {
        self.service
            .lock()
            .map_err(|_| LocalCommitError::Failed)?
            .sync_replace(
                expected.source().as_str(),
                expected.authority_token(),
                expected.digest().as_str(),
                ciphertext,
                master_password,
            )
            .map_err(map_desktop_error)
    }
}

fn map_desktop_error(error: DesktopError) -> LocalCommitError {
    match error {
        DesktopError::Locked => LocalCommitError::Locked,
        DesktopError::UnsavedChanges => LocalCommitError::Dirty,
        DesktopError::ExternalChange => LocalCommitError::Changed,
        DesktopError::SyncUnsupportedProvider => LocalCommitError::Unsupported,
        _ => LocalCommitError::Failed,
    }
}

#[cfg(test)]
mod tests {
    use sync_engine::LocalCommitError;

    use super::map_desktop_error;
    use crate::state::DesktopError;

    #[test]
    fn desktop_local_error_mapping_is_stable() {
        assert!(matches!(
            map_desktop_error(DesktopError::Locked),
            LocalCommitError::Locked
        ));
        assert!(matches!(
            map_desktop_error(DesktopError::UnsavedChanges),
            LocalCommitError::Dirty
        ));
        assert!(matches!(
            map_desktop_error(DesktopError::ExternalChange),
            LocalCommitError::Changed
        ));
        assert!(matches!(
            map_desktop_error(DesktopError::SyncUnsupportedProvider),
            LocalCommitError::Unsupported
        ));
        assert!(matches!(
            map_desktop_error(DesktopError::Internal),
            LocalCommitError::Failed
        ));
    }
}
