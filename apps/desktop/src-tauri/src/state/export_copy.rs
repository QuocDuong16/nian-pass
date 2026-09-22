use std::path::PathBuf;

use super::{DesktopError, DesktopVaultService, error::map_export_error};

impl DesktopVaultService {
    /// Exports the current in-memory vault to a new encrypted KDBX file without
    /// changing the selected source, dirty state, or sync binding.
    pub fn export_copy(&self, destination: PathBuf) -> Result<(), DesktopError> {
        let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
        let credential = self.save_credential.as_ref().ok_or(DesktopError::Locked)?;
        session
            .export_copy_with_credential(destination, credential.as_kdbx())
            .map_err(map_export_error)
    }
}
