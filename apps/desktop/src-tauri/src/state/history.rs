use vault_core::EntryId;
use vault_session::SessionError;

use super::{DesktopError, DesktopVaultService, map_mutation_error};
use crate::dto::{EntryHistoryDto, VaultSnapshotDto};

impl DesktopVaultService {
    pub fn entry_history(&self, entry_id: &str) -> Result<EntryHistoryDto, DesktopError> {
        let session = self.session.as_ref().ok_or(DesktopError::Locked)?;
        let history = session
            .entry_history(&EntryId::new(entry_id))
            .map_err(map_history_error)?;
        Ok(EntryHistoryDto::from_history(&history))
    }

    pub fn restore_entry_history(
        &mut self,
        entry_id: &str,
        history_index: usize,
        expected_document_revision: u64,
    ) -> Result<VaultSnapshotDto, DesktopError> {
        self.require_writable()?;
        let session = self.session.as_mut().ok_or(DesktopError::Locked)?;
        session
            .restore_entry_history(
                &EntryId::new(entry_id),
                history_index,
                expected_document_revision,
            )
            .map_err(map_history_error)?;
        self.snapshot()
    }
}

fn map_history_error(error: SessionError) -> DesktopError {
    match error {
        SessionError::Kdbx(kdbx::KdbxError::StaleHistory) => DesktopError::HistoryChanged,
        SessionError::Kdbx(kdbx::KdbxError::HistoryRestoreUnsupported) => {
            DesktopError::HistoryRestoreUnsupported
        }
        SessionError::Kdbx(kdbx::KdbxError::HistoryRevisionNotFound) => {
            DesktopError::InvalidRequest
        }
        other => map_mutation_error(other),
    }
}
