use std::sync::Mutex;

use sync_provider_core::{CiphertextDigest, RemoteRevision};
use uuid::Uuid;

use crate::{ConflictDescriptor, ConflictOperation, LocalSnapshot, SyncError};

pub(crate) struct ConflictAuthority {
    pending: Mutex<Option<PendingConflict>>,
}

impl ConflictAuthority {
    pub(crate) const fn new() -> Self {
        Self {
            pending: Mutex::new(None),
        }
    }

    pub(crate) fn invalidate_pending_conflict(&self) -> Result<(), SyncError> {
        let mut pending = self.pending.lock().map_err(|_| SyncError::Internal)?;
        *pending = None;
        Ok(())
    }

    pub(crate) fn install(
        &self,
        local: LocalSnapshot,
        remote_bytes: Vec<u8>,
        remote_revision: RemoteRevision,
        base_digest: Option<CiphertextDigest>,
        initial_conflict: bool,
        conflicts: Vec<ConflictDescriptor>,
    ) -> Result<ConflictOperation, SyncError> {
        let operation = ConflictOperation {
            conflict_operation_id: Uuid::new_v4().hyphenated().to_string(),
            initial_conflict,
            conflicts,
        };
        let conflict = PendingConflict {
            operation: operation.clone(),
            local,
            remote_digest: CiphertextDigest::of(&remote_bytes),
            remote_bytes,
            remote_revision,
            base_digest,
        };
        let mut pending = self.pending.lock().map_err(|_| SyncError::Internal)?;
        *pending = Some(conflict);
        Ok(operation)
    }

    pub(crate) fn take(&self, operation_id: &str) -> Result<PendingConflict, SyncError> {
        let mut pending = self.pending.lock().map_err(|_| SyncError::Internal)?;
        if pending
            .as_ref()
            .is_none_or(|conflict| conflict.operation.id() != operation_id)
        {
            return Err(SyncError::StaleConflict);
        }
        pending.take().ok_or(SyncError::StaleConflict)
    }
}

pub(crate) struct PendingConflict {
    pub(crate) local: LocalSnapshot,
    pub(crate) remote_bytes: Vec<u8>,
    pub(crate) remote_digest: CiphertextDigest,
    pub(crate) remote_revision: RemoteRevision,
    pub(crate) base_digest: Option<CiphertextDigest>,
    operation: ConflictOperation,
}
