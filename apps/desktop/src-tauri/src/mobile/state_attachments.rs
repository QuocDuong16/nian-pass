use std::path::Path;

use crate::dto::MobileVaultSnapshotDto;

use super::{
    MobileError,
    state::{MobileOperation, MobileVaultService},
};

impl MobileVaultService {
    pub(crate) fn begin_attachment_import(&mut self) -> Result<MobileOperation, MobileError> {
        if self.active_operation.is_some() {
            return Err(MobileError::Busy);
        }
        let session = self.session.as_ref().ok_or(MobileError::Locked)?;
        if !session.writable() {
            return Err(MobileError::PersistenceUnsupported);
        }
        self.begin_operation()
    }

    pub(crate) fn complete_attachment_import(
        &mut self,
        operation: u64,
        entry_id: &str,
        name: &str,
        staged_path: &Path,
    ) -> Result<MobileVaultSnapshotDto, MobileError> {
        if self.active_operation != Some(operation) {
            return Err(MobileError::Internal);
        }
        let session = self.session.as_mut().ok_or(MobileError::Locked)?;
        if !session.writable() {
            return Err(MobileError::PersistenceUnsupported);
        }
        session.import_entry_attachment(entry_id, name, staged_path)?;
        session.snapshot()
    }

    pub(crate) fn begin_attachment_export(&mut self) -> Result<MobileOperation, MobileError> {
        if self.active_operation.is_some() {
            return Err(MobileError::Busy);
        }
        self.begin_operation()
    }

    pub(crate) fn prepare_attachment_export(
        &self,
        operation: u64,
        entry_id: &str,
        name: &str,
        candidate_path: &Path,
    ) -> Result<(), MobileError> {
        if self.active_operation != Some(operation) {
            return Err(MobileError::Internal);
        }
        self.session
            .as_ref()
            .ok_or(MobileError::Locked)?
            .export_entry_attachment(entry_id, name, candidate_path)
    }
}
