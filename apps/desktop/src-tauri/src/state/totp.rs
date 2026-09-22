use vault_core::{EntryId, SecretString};

use super::{AppState, DesktopError, DesktopVaultService, map_mutation_error};
use crate::clipboard::ClipboardCopy;

impl DesktopVaultService {
    pub fn entry_totp_code(&self, entry_id: &str) -> Result<kdbx::EntryTotpCode, DesktopError> {
        let session = self.require_entry(entry_id)?;
        session
            .entry_totp_code(&EntryId::new(entry_id))
            .map_err(map_mutation_error)
    }

    pub fn entry_totp_secret(&self, entry_id: &str) -> Result<SecretString, DesktopError> {
        self.entry_totp_code(entry_id)
            .map(kdbx::EntryTotpCode::into_code)
    }
}

impl AppState {
    pub fn copy_entry_totp(&self, entry_id: &str) -> Result<ClipboardCopy, DesktopError> {
        self.copy_entry_secret(entry_id, DesktopVaultService::entry_totp_secret)
    }
}
