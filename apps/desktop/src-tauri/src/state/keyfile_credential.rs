use kdbx::KdbxCredential;
use vault_core::{SecretBytes, SecretString};
use vault_session::{SessionError, VaultSession};

use super::{
    DesktopError, DesktopVaultService, credential::DesktopVaultCredential, error::map_save_error,
};

impl DesktopVaultService {
    pub fn replace_keyfile(&mut self, new_keyfile: SecretBytes) -> Result<(), DesktopError> {
        self.require_writable()?;
        let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
        if session.is_dirty() {
            return Err(DesktopError::UnsavedChanges);
        }

        let current = self.save_credential.as_ref().ok_or(DesktopError::Locked)?;
        if current
            .keyfile()
            .is_some_and(|existing| existing.expose_secret() == new_keyfile.expose_secret())
        {
            return Ok(());
        }

        let replacement = KdbxCredential::new(
            current
                .password_component()
                .map(SecretString::expose_secret),
            Some(new_keyfile.expose_secret()),
        );
        let session = self.session.as_mut().ok_or(DesktopError::Locked)?;
        if let Err(error) = session.rotate_credential(current.as_kdbx(), replacement) {
            if rotation_replacement_may_be_installed(&error) {
                self.reconcile_keyfile_authority(Some(new_keyfile))?;
            }
            return Err(map_save_error(error));
        }

        self.replace_retained_keyfile(Some(new_keyfile))
    }

    pub fn remove_keyfile(&mut self) -> Result<(), DesktopError> {
        self.require_writable()?;
        let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
        if session.is_dirty() {
            return Err(DesktopError::UnsavedChanges);
        }

        let current = self.save_credential.as_ref().ok_or(DesktopError::Locked)?;
        if !current.has_keyfile() {
            return Ok(());
        }
        let password = current
            .password_component()
            .ok_or(DesktopError::InvalidRequest)?;
        // A direct IPC caller can open with Some("") + keyfile. Never permit
        // removing that keyfile and leaving the vault with an empty password.
        if password.expose_secret().is_empty() {
            return Err(DesktopError::InvalidRequest);
        }
        let replacement = KdbxCredential::new(Some(password.expose_secret()), None);
        let session = self.session.as_mut().ok_or(DesktopError::Locked)?;
        if let Err(error) = session.rotate_credential(current.as_kdbx(), replacement) {
            if rotation_replacement_may_be_installed(&error) {
                self.reconcile_keyfile_authority(None)?;
            }
            return Err(map_save_error(error));
        }

        self.replace_retained_keyfile(None)
    }

    pub(super) fn reconcile_keyfile_authority(
        &mut self,
        replacement_keyfile: Option<SecretBytes>,
    ) -> Result<(), DesktopError> {
        let candidate = {
            let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
            let current = self.save_credential.as_ref().ok_or(DesktopError::Locked)?;
            let replacement = KdbxCredential::new(
                current
                    .password_component()
                    .map(SecretString::expose_secret),
                replacement_keyfile.as_ref().map(SecretBytes::expose_secret),
            );
            let Ok(candidate) = VaultSession::open_with_credential(session.path(), replacement)
            else {
                return Ok(());
            };
            if VaultSession::open_with_credential(session.path(), current.as_kdbx()).is_ok() {
                return Ok(());
            }
            candidate
        };

        self.session = Some(candidate);
        self.replace_retained_keyfile(replacement_keyfile)
    }

    fn replace_retained_keyfile(
        &mut self,
        keyfile: Option<SecretBytes>,
    ) -> Result<(), DesktopError> {
        let credential = self.save_credential.take().ok_or(DesktopError::Locked)?;
        let (password, _) = credential.into_components();
        self.save_credential = Some(DesktopVaultCredential::new(password, keyfile));
        Ok(())
    }
}

pub(super) fn rotation_replacement_may_be_installed(error: &SessionError) -> bool {
    matches!(
        error,
        SessionError::FinalVerificationFailed(_)
            | SessionError::FinalReadFailed(_)
            | SessionError::SavedButBackupUpdateFailed(_)
            | SessionError::SavedButBackupDurabilityUncertain(_)
            | SessionError::DurabilityUncertain(_)
    )
}
