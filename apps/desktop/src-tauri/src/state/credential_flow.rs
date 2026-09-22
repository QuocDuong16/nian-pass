use kdbx::KdbxCredential;
use vault_core::{SecretBytes, SecretString};

use super::{
    DesktopError, DesktopVaultService, credential::DesktopVaultCredential, error::map_open_error,
    error::map_save_error, keyfile_credential::rotation_replacement_may_be_installed,
    random_process_token, snapshot,
};
use crate::dto::VaultSnapshotDto;
use vault_session::VaultSession;

impl DesktopVaultService {
    pub fn set_pending_keyfile(&mut self, keyfile: SecretBytes) -> Result<(), DesktopError> {
        if self.session.is_some() {
            return Err(DesktopError::AlreadyUnlocked);
        }
        if self.selected_path.is_none() {
            return Err(DesktopError::NoVaultSelected);
        }
        self.pending_keyfile = Some(keyfile);
        Ok(())
    }

    pub fn clear_pending_keyfile(&mut self) -> Result<(), DesktopError> {
        if self.session.is_some() {
            return Err(DesktopError::AlreadyUnlocked);
        }
        self.pending_keyfile = None;
        Ok(())
    }

    pub fn unlock(&mut self, credential: SecretString) -> Result<VaultSnapshotDto, DesktopError> {
        self.unlock_with_components(Some(credential))
    }

    pub fn unlock_with_components(
        &mut self,
        password: Option<SecretString>,
    ) -> Result<VaultSnapshotDto, DesktopError> {
        if self.session.is_some() {
            return Err(DesktopError::AlreadyUnlocked);
        }

        let path = self
            .selected_path
            .as_deref()
            .ok_or(DesktopError::NoVaultSelected)?;
        let credential = KdbxCredential::new(
            password.as_ref().map(SecretString::expose_secret),
            self.pending_keyfile
                .as_ref()
                .map(SecretBytes::expose_secret),
        );
        if !credential.has_component() {
            return Err(DesktopError::InvalidRequest);
        }
        let session =
            VaultSession::open_with_credential(path, credential).map_err(map_open_error)?;
        let snapshot = snapshot::from_session(&session).map_err(map_open_error)?;
        let browser_session_id = random_process_token()?;
        let keyfile = self.pending_keyfile.take();
        self.session = Some(session);
        self.save_credential = Some(DesktopVaultCredential::new(password, keyfile));
        self.browser_session_id = Some(browser_session_id);
        Ok(snapshot)
    }

    pub fn credential_has_keyfile(&self) -> Result<bool, DesktopError> {
        if self.session.is_none() {
            return Err(DesktopError::Locked);
        }
        Ok(self
            .save_credential
            .as_ref()
            .ok_or(DesktopError::Locked)?
            .has_keyfile())
    }

    pub fn credential_has_password(&self) -> Result<bool, DesktopError> {
        if self.session.is_none() {
            return Err(DesktopError::Locked);
        }
        Ok(self
            .save_credential
            .as_ref()
            .ok_or(DesktopError::Locked)?
            .password_component()
            .is_some())
    }

    pub fn save(&mut self) -> Result<VaultSnapshotDto, DesktopError> {
        self.require_writable()?;
        let credential = self.save_credential.as_ref().ok_or(DesktopError::Locked)?;
        let session = self.session.as_mut().ok_or(DesktopError::Locked)?;
        session
            .save_with_credential(credential.as_kdbx())
            .map_err(map_save_error)?;
        self.snapshot()
    }

    pub fn change_master_password(
        &mut self,
        new_password: SecretString,
    ) -> Result<VaultSnapshotDto, DesktopError> {
        self.require_writable()?;
        let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
        if session.is_dirty() {
            return Err(DesktopError::UnsavedChanges);
        }
        if new_password.expose_secret().is_empty() {
            return Err(DesktopError::InvalidRequest);
        }

        let current = self.save_credential.as_ref().ok_or(DesktopError::Locked)?;
        let replacement = KdbxCredential::new(
            Some(new_password.expose_secret()),
            current.keyfile().map(SecretBytes::expose_secret),
        );
        let session = self.session.as_mut().ok_or(DesktopError::Locked)?;
        if let Err(error) = session.rotate_credential(current.as_kdbx(), replacement) {
            if rotation_replacement_may_be_installed(&error) {
                self.reconcile_rotation_authority(Some(new_password))?;
            }
            return Err(map_save_error(error));
        }

        self.replace_retained_password(Some(new_password))?;
        self.snapshot()
    }

    /// Replace a composite credential with keyfile-only authority. A clean,
    /// writable vault and a retained keyfile are mandatory.
    pub fn remove_master_password(&mut self) -> Result<VaultSnapshotDto, DesktopError> {
        self.require_writable()?;
        let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
        if session.is_dirty() {
            return Err(DesktopError::UnsavedChanges);
        }
        let current = self.save_credential.as_ref().ok_or(DesktopError::Locked)?;
        if current.password_component().is_none() {
            return Err(DesktopError::InvalidRequest);
        }
        let keyfile = current.keyfile().ok_or(DesktopError::InvalidRequest)?;
        let replacement = KdbxCredential::new(None, Some(keyfile.expose_secret()));
        let session = self.session.as_mut().ok_or(DesktopError::Locked)?;
        if let Err(error) = session.rotate_credential(current.as_kdbx(), replacement) {
            if rotation_replacement_may_be_installed(&error) {
                self.reconcile_rotation_authority(None)?;
            }
            return Err(map_save_error(error));
        }
        self.replace_retained_password(None)?;
        self.snapshot()
    }

    pub(super) fn reconcile_rotation_authority(
        &mut self,
        new_password: Option<SecretString>,
    ) -> Result<(), DesktopError> {
        let candidate = {
            let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
            let current = self.save_credential.as_ref().ok_or(DesktopError::Locked)?;
            let replacement = KdbxCredential::new(
                new_password.as_ref().map(SecretString::expose_secret),
                current.keyfile().map(SecretBytes::expose_secret),
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
        self.replace_retained_password(new_password)
    }

    fn replace_retained_password(
        &mut self,
        new_password: Option<SecretString>,
    ) -> Result<(), DesktopError> {
        let keyfile = self
            .save_credential
            .take()
            .ok_or(DesktopError::Locked)?
            .into_components()
            .1;
        self.save_credential = Some(DesktopVaultCredential::new(new_password, keyfile));
        Ok(())
    }

    #[cfg(test)]
    pub fn reload(&mut self, credential: SecretString) -> Result<VaultSnapshotDto, DesktopError> {
        self.reload_with_components(Some(credential))
    }

    pub fn reload_with_components(
        &mut self,
        password: Option<SecretString>,
    ) -> Result<VaultSnapshotDto, DesktopError> {
        let path = self
            .session
            .as_ref()
            .ok_or(DesktopError::Locked)?
            .path()
            .to_owned();
        let current = self.save_credential.as_ref().ok_or(DesktopError::Locked)?;
        let credential = KdbxCredential::new(
            password.as_ref().map(SecretString::expose_secret),
            current.keyfile().map(SecretBytes::expose_secret),
        );
        if !credential.has_component() {
            return Err(DesktopError::InvalidRequest);
        }
        let candidate = VaultSession::open_with_credential(path, credential)
            .map_err(|_| DesktopError::ReloadFailed)?;
        let snapshot =
            snapshot::from_session(&candidate).map_err(|_| DesktopError::ReloadFailed)?;
        let browser_session_id = random_process_token()?;
        let keyfile = self
            .save_credential
            .take()
            .ok_or(DesktopError::Locked)?
            .into_components()
            .1;
        self.session = Some(candidate);
        self.save_credential = Some(DesktopVaultCredential::new(password, keyfile));
        self.browser_session_id = Some(browser_session_id);
        Ok(snapshot)
    }
}
