use kdbx::DatabaseMetadata;

use crate::{SessionError, VaultSession};

impl VaultSession {
    /// Reads editable database metadata without projecting it through browse snapshots.
    #[must_use]
    pub fn database_metadata(&self) -> DatabaseMetadata {
        self.document.database_metadata()
    }

    /// Updates editable database metadata atomically in unlocked memory.
    pub fn update_database_metadata(
        &mut self,
        name: &str,
        description: &str,
        default_username: &str,
    ) -> Result<DatabaseMetadata, SessionError> {
        self.document
            .update_database_metadata(name, description, default_username)
            .map_err(SessionError::Kdbx)
    }

    /// Returns the finite per-entry history revision count limit, if any.
    #[must_use]
    pub fn history_max_items(&self) -> Option<usize> {
        self.document.history_max_items()
    }

    /// Returns the highest finite history count this build accepts as a new setting.
    #[must_use]
    pub const fn maximum_editable_history_items(&self) -> usize {
        self.document.maximum_editable_history_items()
    }

    /// Changes and immediately enforces the finite per-entry history revision count.
    pub fn set_history_max_items(&mut self, max_items: Option<usize>) -> Result<(), SessionError> {
        self.document
            .set_history_max_items(max_items)
            .map_err(SessionError::Kdbx)
    }

    /// Changes the KDBX recycle-bin policy in unlocked memory.
    pub fn set_recycle_bin_enabled(&mut self, enabled: bool) -> Result<(), SessionError> {
        self.document
            .set_recycle_bin_enabled(enabled)
            .map_err(SessionError::Kdbx)
    }
}

impl SessionError {
    #[must_use]
    pub const fn is_invalid_database_metadata(&self) -> bool {
        matches!(self, Self::Kdbx(kdbx::KdbxError::InvalidDatabaseMetadata))
    }

    #[must_use]
    pub const fn is_invalid_history_policy(&self) -> bool {
        matches!(self, Self::Kdbx(kdbx::KdbxError::InvalidHistoryPolicy))
    }
}
