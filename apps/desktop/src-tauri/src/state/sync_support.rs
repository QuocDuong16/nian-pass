use std::path::Path;

use sync_provider_core::CiphertextDigest;
use vault_core::SecretString;
use vault_session::SessionError;

use super::{DesktopError, DesktopVaultService, random_process_token};

pub(crate) struct DesktopSyncCapture {
    pub source_binding: String,
    pub authority: String,
    pub ciphertext: Vec<u8>,
}

impl DesktopVaultService {
    pub(crate) fn sync_capture(&self) -> Result<DesktopSyncCapture, DesktopError> {
        let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
        let encrypted = session
            .capture_encrypted()
            .map_err(map_sync_session_error)?;
        let authority = self
            .browser_session_id
            .clone()
            .ok_or(DesktopError::Locked)?;
        Ok(DesktopSyncCapture {
            source_binding: source_binding(session.path()),
            authority,
            ciphertext: encrypted.ciphertext().to_vec(),
        })
    }

    pub(crate) fn sync_source_binding(&self) -> Result<String, DesktopError> {
        self.session
            .as_ref()
            .map(|session| source_binding(session.path()))
            .ok_or(DesktopError::Locked)
    }

    pub(crate) fn sync_replace(
        &mut self,
        expected_source: &str,
        expected_authority: &str,
        expected_digest: &str,
        ciphertext: &[u8],
        credential: &SecretString,
    ) -> Result<(), DesktopError> {
        if self.browser_session_id.as_deref() != Some(expected_authority) {
            return Err(DesktopError::ExternalChange);
        }
        let session = self.session.as_mut().ok_or(DesktopError::Locked)?;
        if source_binding(session.path()) != expected_source {
            return Err(DesktopError::ExternalChange);
        }
        let current = session
            .capture_encrypted()
            .map_err(map_sync_session_error)?;
        if CiphertextDigest::of(current.ciphertext()).as_str() != expected_digest {
            return Err(DesktopError::ExternalChange);
        }
        session
            .replace_encrypted_if_unchanged(current.fingerprint(), ciphertext, credential)
            .map_err(map_sync_session_error)?;
        self.browser_session_id = Some(random_process_token()?);
        Ok(())
    }
}

fn map_sync_session_error(error: SessionError) -> DesktopError {
    match error {
        SessionError::UnsavedChanges => DesktopError::UnsavedChanges,
        SessionError::ExternalModificationDetected
        | SessionError::FinalExternalModificationDetected
        | SessionError::UnsupportedPath
        | SessionError::ReadSource(_) => DesktopError::ExternalChange,
        SessionError::UnsupportedPersistencePlatform => DesktopError::SyncUnsupportedProvider,
        SessionError::CredentialMismatch
        | SessionError::TempVerificationFailed(kdbx::KdbxError::InvalidCredentials) => {
            DesktopError::SyncCredentialsRequired
        }
        _ => DesktopError::SyncFailed,
    }
}

fn source_binding(path: &Path) -> String {
    #[cfg(unix)]
    let bytes = {
        use std::os::unix::ffi::OsStrExt as _;
        path.as_os_str().as_bytes().to_vec()
    };
    #[cfg(windows)]
    let bytes = {
        use std::os::windows::ffi::OsStrExt as _;
        path.as_os_str()
            .encode_wide()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>()
    };
    CiphertextDigest::of(&bytes).as_str().to_owned()
}

#[cfg(test)]
mod tests {
    use kdbx::KdbxError;
    use vault_session::SessionError;

    use super::{map_sync_session_error, source_binding};
    use crate::state::DesktopError;

    #[test]
    fn sync_error_mapping_and_source_identity_fail_closed() {
        assert_eq!(source_binding(std::path::Path::new("vault.kdbx")).len(), 64);
        for (error, expected) in [
            (SessionError::UnsavedChanges, DesktopError::UnsavedChanges),
            (
                SessionError::ExternalModificationDetected,
                DesktopError::ExternalChange,
            ),
            (
                SessionError::UnsupportedPersistencePlatform,
                DesktopError::SyncUnsupportedProvider,
            ),
            (
                SessionError::CredentialMismatch,
                DesktopError::SyncCredentialsRequired,
            ),
            (
                SessionError::TempVerificationFailed(KdbxError::InvalidCredentials),
                DesktopError::SyncCredentialsRequired,
            ),
            (
                SessionError::Kdbx(KdbxError::InvalidKdbx),
                DesktopError::SyncFailed,
            ),
        ] {
            assert_eq!(map_sync_session_error(error), expected);
        }
    }
}
