use credential_provider_core::{
    Credential, CredentialCandidate, CredentialTarget, candidates, credential,
};

use super::{DesktopError, DesktopVaultService, map_provider_error};

impl DesktopVaultService {
    pub fn browser_candidates(
        &self,
        target: &CredentialTarget,
    ) -> Result<(&str, Vec<CredentialCandidate>), DesktopError> {
        let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
        let session_id = self
            .browser_session_id
            .as_deref()
            .ok_or(DesktopError::Locked)?;
        let candidates = candidates(session.document(), target).map_err(map_provider_error)?;
        Ok((session_id, candidates))
    }

    pub fn browser_credential(
        &self,
        expected_session_id: &str,
        entry_id: &str,
        target: &CredentialTarget,
    ) -> Result<Credential, DesktopError> {
        let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
        if self.browser_session_id.as_deref() != Some(expected_session_id) {
            return Err(DesktopError::SecretUnavailable);
        }
        credential(session.document(), entry_id, target).map_err(map_provider_error)
    }

    #[must_use]
    pub fn browser_vault_is_unlocked(&self) -> bool {
        self.session.is_some() && self.browser_session_id.is_some()
    }
}
