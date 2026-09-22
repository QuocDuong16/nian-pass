use crate::{
    dto::{
        DatabaseMetadataDto, DatabaseMetadataUpdateReceiptDto, HistoryPolicyDto,
        HistoryPolicyUpdateReceiptDto, VaultSnapshotDto,
    },
    state::{DesktopError, DesktopVaultService},
};

impl DesktopVaultService {
    pub fn database_metadata(&self) -> Result<DatabaseMetadataDto, DesktopError> {
        let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
        Ok(session.database_metadata().into())
    }

    pub fn update_database_metadata(
        &mut self,
        name: &str,
        description: &str,
        default_username: &str,
    ) -> Result<DatabaseMetadataUpdateReceiptDto, DesktopError> {
        let metadata = self
            .session_mut()?
            .update_database_metadata(name, description, default_username)
            .map_err(super::map_mutation_error)?
            .into();
        let snapshot = self.snapshot()?;
        Ok(DatabaseMetadataUpdateReceiptDto { metadata, snapshot })
    }

    pub fn history_policy(&self) -> Result<HistoryPolicyDto, DesktopError> {
        let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
        Ok(HistoryPolicyDto {
            max_items: session.history_max_items(),
            maximum_editable_items: session.maximum_editable_history_items(),
        })
    }

    pub fn set_history_max_items(
        &mut self,
        max_items: Option<usize>,
    ) -> Result<HistoryPolicyUpdateReceiptDto, DesktopError> {
        self.session_mut()?
            .set_history_max_items(max_items)
            .map_err(super::map_mutation_error)?;
        let policy = self.history_policy()?;
        let snapshot = self.snapshot()?;
        Ok(HistoryPolicyUpdateReceiptDto { policy, snapshot })
    }

    pub fn set_recycle_bin_enabled(
        &mut self,
        enabled: bool,
    ) -> Result<VaultSnapshotDto, DesktopError> {
        self.session_mut()?
            .set_recycle_bin_enabled(enabled)
            .map_err(super::map_mutation_error)?;
        self.snapshot()
    }
}
