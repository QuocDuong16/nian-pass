use vault_core::{EntryId, SecretBytes};

use super::{DesktopError, DesktopVaultService, map_mutation_error};
use crate::dto::VaultSnapshotDto;

impl DesktopVaultService {
    pub fn set_entry_custom_icon_png(
        &mut self,
        entry_id: &str,
        bytes: &SecretBytes,
    ) -> Result<VaultSnapshotDto, DesktopError> {
        if entry_id.is_empty() {
            return Err(DesktopError::InvalidRequest);
        }
        self.session_mut()?
            .set_entry_custom_icon_png(&EntryId::new(entry_id), bytes)
            .map_err(map_mutation_error)?;
        self.snapshot()
    }
}
